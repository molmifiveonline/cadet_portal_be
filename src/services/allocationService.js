const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { calculateFinalScore, calculateAcademicAssessmentAverage, normalizeDepartment, sortAutoRank } = require('./allocationRules');

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

const getAssessmentTypeSnapshot = async (connection, department) => {
  const [courses] = await connection.query(
    `SELECT id, code, name
     FROM assessment_courses WHERE status='Active' ORDER BY name`,
  );
  if (!courses.length) throw httpError(400, 'Add at least one active Assessment Type before creating an allocation');
  return {
    name: 'Assessment Types',
    version: 1,
    department,
    scoring_method: 'AcademicAssessmentAverage',
    components: courses.map((course, index) => ({
      course_id: course.id,
      code: course.code,
      name: course.name,
      max_score: 10,
      weight: 0,
      sort_order: index,
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

const createCycle = async ({ year, userId }) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const allocationYear = Number(year);
    if (!Number.isInteger(allocationYear) || allocationYear < 2000 || allocationYear > 2100) throw httpError(400, 'A valid allocation year is required');
    await connection.query(
      `INSERT INTO allocation_year_sequences (allocation_year,last_number) VALUES (?,0)
       ON DUPLICATE KEY UPDATE allocation_year=VALUES(allocation_year)`, [allocationYear],
    );
    const [sequences] = await connection.query(`SELECT last_number FROM allocation_year_sequences WHERE allocation_year=? FOR UPDATE`, [allocationYear]);
    const nextNumber = Number(sequences[0].last_number) + 1;
    await connection.query(`UPDATE allocation_year_sequences SET last_number=? WHERE allocation_year=?`, [nextNumber, allocationYear]);
    const allocationNumber = `CTV-${allocationYear}-${String(nextNumber).padStart(4, '0')}`;
    const cycleId = uuidv4();
    const deckSnapshot = await getAssessmentTypeSnapshot(connection, 'Deck');
    const engineSnapshot = await getAssessmentTypeSnapshot(connection, 'Engine');
    await connection.query(`INSERT INTO allocation_cycles (id,allocation_number,allocation_year,created_by) VALUES (?,?,?,?)`, [cycleId, allocationNumber, allocationYear, userId]);
    for (const snapshot of [deckSnapshot, engineSnapshot]) {
      await connection.query(
        `INSERT INTO allocation_rank_lists (id,cycle_id,department,formula_template_id,formula_snapshot) VALUES (?,?,?,?,?)`,
        [uuidv4(), cycleId, snapshot.department, null, JSON.stringify(snapshot)],
      );
    }
    await connection.commit();
    return { id: cycleId, allocation_number: allocationNumber };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
};

const addCandidates = async ({ rankListId, cadetIds, userId }) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const rankList = await getRankList(connection, rankListId, true); ensureDraft(rankList);
    for (const cadetId of [...new Set(cadetIds || [])]) {
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
      const allocationId = uuidv4();
      await connection.query(
        `INSERT INTO allocations (id,rank_list_id,cadet_id,allocation_status,academic_score,is_active,added_by)
         VALUES (?,?,?,'Pending',?,1,?)`, [allocationId, rankListId, cadetId, academicScore, userId],
      );
    }
    await recalculateRanks(connection, rankListId);
    await connection.commit();
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
