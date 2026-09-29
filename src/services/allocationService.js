const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { calculateFinalScore, calculateAcademicAssessmentAverage, normalizeDepartment, sortAutoRank } = require('./allocationRules');
const { createCycle } = require('./allocationCycleService');

const httpError = (status, message) => Object.assign(new Error(message), { status });

const parseJson = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
};

const getFormulaSnapshot = async (connection, templateId, department) => {
  const [templates] = await connection.query(
    `SELECT * FROM score_formula_templates WHERE id=? AND department=? AND status='Active'`,
    [templateId, department],
  );
  if (!templates[0]) throw httpError(400, `An active ${department} score formula is required`);
  const [components] = await connection.query(
    `SELECT fc.course_id, c.code, c.name, fc.weight, fc.max_score, fc.sort_order
     FROM score_formula_components fc JOIN assessment_courses c ON c.id=fc.course_id
     WHERE fc.template_id=? ORDER BY fc.sort_order, c.name`, [templateId],
  );
  return {
    template_id: templateId,
    name: templates[0].name,
    version: templates[0].version,
    department,
    academic_weight: Number(templates[0].academic_weight),
    components: components.map((component) => ({
      course_id: component.course_id,
      code: component.code,
      name: component.name,
      weight: Number(component.weight),
      max_score: Number(component.max_score),
      sort_order: component.sort_order,
    })),
  };
};

const getRankList = async (connection, rankListId, lock = false) => {
  const [rows] = await connection.query(
    `SELECT rl.*, ac.allocation_number, ac.allocation_year
     FROM allocation_rank_lists rl JOIN allocation_cycles ac ON ac.id=rl.cycle_id
     WHERE rl.id=? ${lock ? 'FOR UPDATE' : ''}`, [rankListId],
  );
  if (!rows[0]) throw httpError(404, 'Rank list not found');
  rows[0].formula_snapshot = parseJson(rows[0].formula_snapshot, {});
  return rows[0];
};

const ensureDraft = (rankList) => {
  if (rankList.status !== 'Draft') throw httpError(409, 'This rank list is finalized and locked');
};

const recalculateRanks = async (connection, rankListId, force = false) => {
  const rankList = await getRankList(connection, rankListId);
  if (!force && rankList.ranking_mode === 'Manual') return;
  const [rows] = await connection.query(
    `SELECT a.id, a.cadet_id, a.academic_score, a.final_score, c.cadet_unique_id
     FROM allocations a JOIN cadets c ON c.id=a.cadet_id
     WHERE a.rank_list_id=? AND a.is_active=1`, [rankListId],
  );
  await connection.query(`UPDATE allocations SET current_rank=NULL WHERE rank_list_id=? AND is_active=1`, [rankListId]);
  const ranked = sortAutoRank(rows.filter((row) => row.final_score !== null));
  for (let index = 0; index < ranked.length; index += 1) {
    await connection.query(`UPDATE allocations SET current_rank=? WHERE id=?`, [index + 1, ranked[index].id]);
  }
};

const updateFinalScore = async (connection, allocationId, userId) => {
  const [allocations] = await connection.query(
    `SELECT a.*, rl.formula_snapshot, rl.id AS list_id, rl.status AS list_status, rl.ranking_mode
     FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id WHERE a.id=?`, [allocationId],
  );
  if (!allocations[0]) throw httpError(404, 'Candidate allocation not found');
  if (allocations[0].list_status !== 'Draft') throw httpError(409, 'Assessment scores are locked');
  const snapshot = parseJson(allocations[0].formula_snapshot, {});
  const [scores] = await connection.query(
    `SELECT * FROM allocation_score_entries WHERE allocation_id=? ORDER BY created_at`, [allocationId],
  );
  scores.forEach((score) => { score.academic_weight = snapshot.academic_weight; });
  const usesAssessmentAverage = ['SimpleTotal', 'AcademicAssessmentAverage'].includes(snapshot.scoring_method);
  const finalScore = usesAssessmentAverage
    ? calculateAcademicAssessmentAverage(allocations[0].academic_score, scores)
    : calculateFinalScore(allocations[0].academic_score, scores);
  await connection.query(`UPDATE allocations SET final_score=? WHERE id=?`, [finalScore, allocationId]);
  if (allocations[0].ranking_mode === 'Auto') await recalculateRanks(connection, allocations[0].list_id);
  return finalScore;
};

const addCandidates = async ({ rankListId, cadetIds, candidates, userId }) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const rankList = await getRankList(connection, rankListId, true); ensureDraft(rankList);
    const requestedCandidates = Array.isArray(candidates) && candidates.length
      ? candidates
      : (cadetIds || []).map((cadetId) => ({ cadet_id: cadetId }));
    const uniqueCandidates = [...new Map(
      requestedCandidates.map((item) => [String(item.cadet_id || '').trim(), item]),
    ).values()].filter((item) => String(item.cadet_id || '').trim());
    if (!uniqueCandidates.length) throw httpError(400, 'Select at least one valid candidate');
    const added = [];
    for (const candidateConfig of uniqueCandidates) {
      const cadetId = String(candidateConfig.cadet_id).trim();
      const [rows] = await connection.query(
        `SELECT c.*, dv.status AS document_verification_status
         FROM cadets c LEFT JOIN document_verifications dv ON dv.cadet_id=c.id
         WHERE c.id=? FOR UPDATE`, [cadetId],
      );
      const cadet = rows[0];
      if (!cadet) throw httpError(404, 'Candidate not found');
      const [documents] = await connection.query(
        `SELECT id, status FROM cadet_documents WHERE cadet_id=? FOR UPDATE`,
        [cadetId],
      );
      if (
        cadet.document_verification_status !== 'Verified' ||
        !documents.length ||
        documents.some((document) => document.status !== 'accepted')
      ) {
        throw httpError(400, `${cadet.name_as_in_indos_cert} is not approved from Recruitment Drive Documents`);
      }
      if (!(cadet.workflow_phase === 'selected' || ['Selected','Medical Completed','CTV Assigned'].includes(cadet.status))) throw httpError(400, `${cadet.name_as_in_indos_cert} is not in the selected/document stage`);
      if (normalizeDepartment(cadet.course) !== rankList.department) throw httpError(400, `${cadet.name_as_in_indos_cert} does not belong to ${rankList.department}`);
      const academicScore = Number(cadet.imu_avg_all_semester_percentage);
      if (!Number.isFinite(academicScore) || academicScore < 0 || academicScore > 100) throw httpError(400, `${cadet.name_as_in_indos_cert} has an invalid IMU average`);
      const [duplicates] = await connection.query(
        `SELECT ac.allocation_number FROM allocations a
         JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id
         WHERE a.cadet_id=? AND a.is_active=1 AND ac.status='Active' LIMIT 1`, [cadetId],
      );
      if (duplicates.length) throw httpError(409, `${cadet.name_as_in_indos_cert} already belongs to ${duplicates[0].allocation_number}`);

      const scores = Array.isArray(candidateConfig.scores) ? candidateConfig.scores : [];
      const courseIds = scores.map((score) => String(score.course_id || '').trim());
      if (courseIds.some((courseId) => !courseId)) throw httpError(400, `Select an Assessment Type for every score entered for ${cadet.name_as_in_indos_cert}`);
      if (new Set(courseIds).size !== courseIds.length) throw httpError(400, `Assessment Types must be unique for ${cadet.name_as_in_indos_cert}`);
      const coursesById = new Map();
      if (courseIds.length) {
        const [courses] = await connection.query(
          `SELECT id,name,status FROM assessment_courses WHERE id IN (?) FOR UPDATE`,
          [courseIds],
        );
        courses.forEach((course) => coursesById.set(course.id, course));
      }
      const normalizedScores = scores.map((score) => {
        const course = coursesById.get(String(score.course_id).trim());
        const value = Number(score.score);
        if (!course || course.status !== 'Active') throw httpError(400, `Select an active Assessment Type for ${cadet.name_as_in_indos_cert}`);
        if (score.score === '' || score.score === null || score.score === undefined) throw httpError(400, `${course.name} score is required`);
        if (!Number.isFinite(value) || value < 0 || value > 100) throw httpError(400, `${course.name} score must be between 0 and 100`);
        return { course_id: course.id, course_name: course.name, score: value, max_score_snapshot: 100 };
      });

      const vesselTypeId = String(candidateConfig.vessel_type_id || '').trim() || null;
      if (vesselTypeId) {
        const [types] = await connection.query(
          `SELECT id,name,department,status FROM vessel_types WHERE id=? FOR UPDATE`,
          [vesselTypeId],
        );
        const type = types[0];
        if (!type || type.status !== 'Active' || ![rankList.department, 'Both'].includes(type.department)) {
          throw httpError(400, `Select a compatible active vessel type for ${cadet.name_as_in_indos_cert}`);
        }
      }

      const allocationId = uuidv4();
      const finalScore = normalizedScores.length
        ? calculateAcademicAssessmentAverage(academicScore, normalizedScores)
        : null;
      await connection.query(
        `INSERT INTO allocations (id,rank_list_id,cadet_id,allocation_status,academic_score,final_score,vessel_type_id,is_active,added_by)
         VALUES (?,?,?,'Pending',?,?,?,1,?)`,
        [allocationId, rankListId, cadetId, academicScore, finalScore, vesselTypeId, userId],
      );
      for (const score of normalizedScores) {
        await connection.query(
          `INSERT INTO allocation_score_entries
           (id,allocation_id,course_id,course_name_snapshot,max_score_snapshot,weight_snapshot,score,updated_by)
           VALUES (?,?,?,?,100,0,?,?)`,
          [uuidv4(), allocationId, score.course_id, score.course_name, score.score, userId],
        );
      }
      added.push({ allocation_id: allocationId, cadet_id: cadetId,
        cadet_name: cadet.name_as_in_indos_cert, cadet_unique_id: cadet.cadet_unique_id });
    }
    await recalculateRanks(connection, rankListId);
    await connection.commit();
    return added;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
};

module.exports = {
  httpError,
  parseJson,
  getRankList,
  ensureDraft,
  recalculateRanks,
  updateFinalScore,
  createCycle,
  addCandidates,
};
