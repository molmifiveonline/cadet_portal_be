const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const activityLogDao = require('../dao/activityLogDao');
const { normalizeDepartment, createDirectionalRankMovePlan, ensureAllocationEnabled } = require('../services/allocationRules');
const { unixTimestampToIso } = require('../utils/dateUtils');
const {
  httpError,
  parseJson,
  getRankList,
  ensureDraft,
  recalculateRanks,
  updateFinalScore,
  createCycle: createCycleService,
  addCandidates: addCandidatesService,
} = require('../services/allocationService');

const errorResponse = (res, error) => {
  console.error('Allocation Error:', error);
  return res.status(error.status || 500).json({
    success: false,
    message: error.status ? error.message : 'CTV allocation operation failed',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
};

const logAction = (req, action, details, connection = db) => activityLogDao.createLog(
  req.user?.id, action, details, req.ip || req.connection?.remoteAddress, connection,
);

const allocationActivityLabel = async (connection, allocationId) => {
  const [rows] = await connection.query(
    `SELECT c.name_as_in_indos_cert,c.cadet_unique_id,rl.department,ac.allocation_number
     FROM allocations a JOIN cadets c ON c.id=a.cadet_id
     JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
     JOIN allocation_cycles ac ON ac.id=rl.cycle_id WHERE a.id=?`, [allocationId],
  );
  if (!rows[0]) throw httpError(404, 'Candidate allocation not found');
  const item = rows[0];
  return `${item.name_as_in_indos_cert} (${item.cadet_unique_id || allocationId}) in ${item.department} allocation ${item.allocation_number}`;
};

const listCycles = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ac.*,
        UNIX_TIMESTAMP(ac.deleted_at) AS deleted_at_epoch,
        COALESCE(MAX(NULLIF(TRIM(CONCAT_WS(' ',du.first_name,du.last_name)),'')),MAX(du.email),ac.deleted_by) AS deleted_by_name,
        COUNT(DISTINCT jp.id) AS existing_joining_plan_count,
        COUNT(DISTINCT o.id) AS existing_onboarding_count,
        MAX(rl.status) AS rank_list_status,
        MAX(CASE WHEN rl.department='Deck' THEN rl.status END) AS deck_status,
        MAX(CASE WHEN rl.department='Engine' THEN rl.status END) AS engine_status,
        COUNT(DISTINCT CASE WHEN a.is_active=1 THEN a.id END) AS candidate_count,
        COUNT(DISTINCT CASE WHEN a.is_active=1 AND a.final_score IS NOT NULL THEN a.id END) AS scored_count,
        COUNT(DISTINCT CASE WHEN a.is_active=1 AND (a.allocation_status='Allocated' OR a.secondary_allocation_status='Allocated') THEN a.id END) AS allocated_count,
        COUNT(DISTINCT CASE WHEN a.is_active=1 AND rl.status='Finalized' THEN a.id END) AS finalized_candidate_count,
        COUNT(DISTINCT CASE WHEN a.is_active=1 AND jp.id IS NOT NULL AND jp.requires_refresh=0 THEN a.id END) AS joining_plan_count,
        COUNT(DISTINCT CASE WHEN a.is_active=1 AND EXISTS (
          SELECT 1 FROM joining_plans informed_jp
          JOIN allocation_communications informed_cm ON informed_cm.joining_plan_id=informed_jp.id
          WHERE informed_jp.allocation_id=a.id
            AND informed_jp.requires_refresh=0 AND informed_cm.plan_revision=informed_jp.revision
            AND (informed_cm.mode='Email' AND informed_cm.delivery_status='Sent')
        ) THEN a.id END) AS informed_count,
        COUNT(DISTINCT CASE WHEN a.is_active=1 AND o.status='Onboarded' THEN a.id END) AS onboarded_count
       FROM allocation_cycles ac
       LEFT JOIN users du ON du.id=ac.deleted_by
       JOIN allocation_rank_lists rl ON rl.cycle_id=ac.id
       LEFT JOIN allocations a ON a.rank_list_id=rl.id
       LEFT JOIN joining_plans jp ON jp.allocation_id=a.id
       LEFT JOIN onboarding o ON o.allocation_id=a.id
       GROUP BY ac.id ORDER BY ac.allocation_year DESC, ac.created_at DESC`,
    );
    res.json({ success: true, data: rows.map(({ deleted_at_epoch, ...row }) => ({ ...row, deleted_at: unixTimestampToIso(deleted_at_epoch) })) });
  } catch (error) { errorResponse(res, error); }
};

const hydrateCycle = async (cycleId) => {
  const [cycles] = await db.query(
    `SELECT ac.*,UNIX_TIMESTAMP(ac.deleted_at) AS deleted_at_epoch,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',du.first_name,du.last_name)),''),du.email,ac.deleted_by) AS deleted_by_name,
      (SELECT COUNT(*) FROM joining_plans jp
       JOIN allocations a ON a.id=jp.allocation_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       WHERE rl.cycle_id=ac.id) AS existing_joining_plan_count,
      (SELECT COUNT(*) FROM onboarding o
       JOIN allocations a ON a.id=o.allocation_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       WHERE rl.cycle_id=ac.id) AS existing_onboarding_count
     FROM allocation_cycles ac LEFT JOIN users du ON du.id=ac.deleted_by WHERE ac.id=?`, [cycleId],
  );
  if (!cycles[0]) throw httpError(404, 'Allocation cycle not found');
  cycles[0].deleted_at = unixTimestampToIso(cycles[0].deleted_at_epoch);
  delete cycles[0].deleted_at_epoch;
  const [lists] = await db.query(
      `SELECT rl.*, COALESCE(f.name, 'Assessment Types') AS formula_name, COALESCE(f.version, 1) AS formula_version
     FROM allocation_rank_lists rl LEFT JOIN score_formula_templates f ON f.id=rl.formula_template_id
     WHERE rl.cycle_id=? ORDER BY FIELD(rl.department,'Deck','Engine')`, [cycleId],
  );
  for (const list of lists) {
    list.formula_snapshot = parseJson(list.formula_snapshot, {});
    const [rankHistory] = await db.query(
      `SELECT h.id,h.allocation_id,h.action,h.from_rank,h.to_rank,h.remarks,
              h.changed_by,h.created_at,
              NULLIF(TRIM(CONCAT_WS(' ',u.first_name,u.last_name)),'') AS changed_by_name,
              u.email AS changed_by_email
       FROM allocation_rank_history h
       LEFT JOIN users u ON u.id=h.changed_by
       WHERE h.rank_list_id=?
       ORDER BY h.created_at DESC,h.id DESC`,
      [list.id],
    );
    list.admin_remarks_history = rankHistory.filter((event) => ['Finalize', 'Unlock', 'Reset'].includes(event.action));
    const [allocations] = await db.query(
      `SELECT a.*, c.cadet_unique_id, c.name_as_in_indos_cert, c.email_id, c.course, c.batch_year,
              c.tenth_avg_percentage,c.twelfth_pcm_avg_percentage,
              c.imu_avg_all_semester_percentage AS profile_academic_score,
              c.imu_sem_1_percentage,c.imu_sem_2_percentage,c.imu_sem_3_percentage,c.imu_sem_4_percentage,
              c.imu_sem_5_percentage,c.imu_sem_6_percentage,c.imu_sem_7_percentage,c.imu_sem_8_percentage,
              i.institute_name, vt.name AS vessel_type_name, svt.name AS secondary_vessel_type_name,
              v.name AS vessel_name, v.total_seats, v.joining_date, v.location, v.voyage_ref, v.reporting_port,
              sv.name AS secondary_vessel_name, sv.total_seats AS secondary_total_seats,
              sv.joining_date AS secondary_joining_date, sv.location AS secondary_location,
              sv.voyage_ref AS secondary_voyage_ref, sv.reporting_port AS secondary_reporting_port,
              pjp.id AS primary_joining_plan_id, pjp.status AS primary_joining_plan_status,
              pjp.requires_refresh AS primary_joining_plan_requires_refresh,
              sjp.id AS secondary_joining_plan_id, sjp.status AS secondary_joining_plan_status,
              sjp.requires_refresh AS secondary_joining_plan_requires_refresh,
              o.id AS onboarding_id, o.status AS onboarding_status,o.admission_source AS onboarding_admission_source,
              (COALESCE(o.passport_verified,0) + COALESCE(o.medical_cert_verified,0)
                + COALESCE(o.bank_details_verified,0) + COALESCE(o.agreement_signed,0)
                + COALESCE(o.final_clearance,0)) AS onboarding_completed_checks,
              EXISTS(
                SELECT 1 FROM joining_plans ijp
                JOIN allocation_communications ic ON ic.joining_plan_id=ijp.id
                WHERE ijp.allocation_id=a.id
                  AND ijp.requires_refresh=0 AND ic.plan_revision=ijp.revision
                  AND (ic.mode='Email' AND ic.delivery_status='Sent')
              ) AS joining_intimation_complete
       FROM allocations a JOIN cadets c ON c.id=a.cadet_id
       LEFT JOIN institutes i ON i.id=c.institute_id
       LEFT JOIN vessel_types vt ON vt.id=a.vessel_type_id
       LEFT JOIN vessel_types svt ON svt.id=a.secondary_vessel_type_id
       LEFT JOIN vessels v ON v.id=a.vessel_id
       LEFT JOIN vessels sv ON sv.id=a.secondary_vessel_id
       LEFT JOIN joining_plans pjp ON pjp.allocation_id=a.id AND pjp.vessel_role='Primary'
       LEFT JOIN joining_plans sjp ON sjp.allocation_id=a.id AND sjp.vessel_role='Secondary'
       LEFT JOIN onboarding o ON o.allocation_id=a.id
       WHERE a.rank_list_id=? AND a.is_active=1
       ORDER BY a.current_rank IS NULL, a.current_rank, c.cadet_unique_id`, [list.id],
    );
    if (allocations.length) {
      const [scores] = await db.query(
        `SELECT * FROM allocation_score_entries WHERE allocation_id IN (?) ORDER BY created_at`, [allocations.map((item) => item.id)],
      );
      const grouped = scores.reduce((map, score) => { (map[score.allocation_id] ||= []).push(score); return map; }, {});
      const groupedRankHistory = rankHistory.reduce((map, event) => {
        if (['MoveUp', 'MoveDown'].includes(event.action)) {
          (map[event.allocation_id] ||= []).push(event);
        }
        return map;
      }, {});
      allocations.forEach((allocation) => {
        allocation.scores = grouped[allocation.id] || [];
        allocation.rank_history = groupedRankHistory[allocation.id] || [];
        allocation.joining_plan_id = allocation.primary_joining_plan_id || allocation.secondary_joining_plan_id || null;
      });
    }
    list.allocations = allocations;
  }
  return { ...cycles[0], rank_lists: lists };
};

const getCycle = async (req, res) => {
  try { res.json({ success: true, data: await hydrateCycle(req.params.id) }); }
  catch (error) { errorResponse(res, error); }
};

const createCycle = async (req, res) => {
  try {
    const { year, department } = req.body;
    const data = await createCycleService({ year, department, userId: req.user.id });
    await logAction(req, 'CREATE_CTV_ALLOCATION', `Created ${data.department} allocation cycle ${data.allocation_number}`);
    res.status(201).json({ success: true, data });
  } catch (error) { errorResponse(res, error); }
};

// Keep the existing DELETE endpoint, but retain every record permanently.
const deleteCycle = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [cycles] = await connection.query(
      `SELECT id,allocation_number,department,status,deleted_at FROM allocation_cycles WHERE id=? FOR UPDATE`,
      [req.params.id],
    );
    if (!cycles[0]) throw httpError(404, 'Allocation cycle not found');
    ensureAllocationEnabled(cycles[0]);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason || reason.length > 1000) throw httpError(400, 'Enter a reason for disabling this allocation (1–1000 characters)');

    const [finalizedLists] = await connection.query(
      `SELECT department FROM allocation_rank_lists WHERE cycle_id=? AND status='Finalized' FOR UPDATE`,
      [req.params.id],
    );
    if (finalizedLists.length) {
      throw httpError(
        409,
        `Cannot disable this allocation because the ${finalizedLists.map((list) => list.department).join(' and ')} Rank List is finalized`,
      );
    }

    const [joiningPlans] = await connection.query(
      `SELECT jp.id FROM joining_plans jp
       JOIN allocations a ON a.id=jp.allocation_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       WHERE rl.cycle_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id],
    );
    if (joiningPlans.length) throw httpError(409, 'Cannot disable an allocation that has a Joining Plan');

    const [onboardingRecords] = await connection.query(
      `SELECT o.id FROM onboarding o
       JOIN allocations a ON a.id=o.allocation_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       WHERE rl.cycle_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id],
    );
    if (onboardingRecords.length) throw httpError(409, 'Cannot disable an allocation that has Onboarding records');

    await connection.query(
      `UPDATE allocation_cycles SET deleted_at=CURRENT_TIMESTAMP,deleted_by=?,delete_reason=? WHERE id=? AND deleted_at IS NULL`,
      [req.user.id, reason, req.params.id],
    );
    await logAction(req, 'DISABLE_CTV_ALLOCATION', `Disabled ${cycles[0].department} allocation ${cycles[0].allocation_number}; reason: ${reason}. Records retained; eligible cadets released for reallocation.`, connection);
    await connection.commit();
    res.json({ success: true, message: `${cycles[0].allocation_number} disabled` });
  } catch (error) {
    await connection.rollback();
    errorResponse(res, error);
  } finally {
    connection.release();
  }
};

const listEligibleCandidates = async (req, res) => {
  try {
    const rankList = await getRankList(db, req.params.rankListId);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const search = String(req.query.search || '').trim().toLowerCase();
    const batchYear = String(req.query.batch_year || '').trim();
    const instituteId = String(req.query.institute_id || '').trim();
    const eligibility = String(req.query.eligibility || 'eligible').trim().toLowerCase();
    const where = `WHERE (c.workflow_phase='selected' OR c.status IN ('Selected','Medical Completed','CTV Assigned'))
      AND c.status <> 'Onboarded' AND COALESCE(c.workflow_result,'') <> 'onboarded'
      AND dv.status='Verified'
      AND EXISTS (SELECT 1 FROM cadet_documents cdv WHERE cdv.cadet_id=c.id)
      AND NOT EXISTS (
        SELECT 1 FROM cadet_documents cdv
        WHERE cdv.cadet_id=c.id AND COALESCE(cdv.status,'') <> 'accepted'
      )`;
    const [rows] = await db.query(
      `SELECT c.id, c.cadet_unique_id, c.name_as_in_indos_cert, c.course, c.batch_year,
              c.imu_avg_all_semester_percentage AS academic_score, c.institute_id, i.institute_name,
              dv.status AS document_verification_status, dv.remarks AS verification_remarks,
              EXISTS(SELECT 1 FROM allocations ax JOIN allocation_rank_lists rlx ON rlx.id=ax.rank_list_id
                     JOIN allocation_cycles acx ON acx.id=rlx.cycle_id
                     WHERE ax.cadet_id=c.id AND ax.is_active=1 AND acx.status='Active' AND acx.deleted_at IS NULL) AS already_allocated
       FROM cadets c LEFT JOIN institutes i ON i.id=c.institute_id
       JOIN document_verifications dv ON dv.cadet_id=c.id
       ${where} ORDER BY c.batch_year DESC, i.institute_name, c.name_as_in_indos_cert`,
    );
    const departmentCandidates = rows.filter((row) => normalizeDepartment(row.course) === rankList.department).map((row) => {
      const academic = Number(row.academic_score);
      const reasons = [];
      if (!Number.isFinite(academic) || academic < 0 || academic > 100) reasons.push('IMU academic score is missing or invalid');
      if (row.already_allocated) reasons.push('Candidate already belongs to an active allocation');
      return { ...row, eligible: reasons.length === 0, ineligible_reasons: reasons };
    });

    const batches = [...new Set(departmentCandidates.map((row) => row.batch_year).filter(Boolean))]
      .sort((left, right) => Number(right) - Number(left));
    const institutes = [...new Map(
      departmentCandidates
        .filter((row) => row.institute_id && row.institute_name)
        .map((row) => [row.institute_id, { id: row.institute_id, name: row.institute_name }]),
    ).values()].sort((left, right) => left.name.localeCompare(right.name));
    const eligibleCount = departmentCandidates.filter((row) => row.eligible).length;
    const needsAttentionCount = departmentCandidates.length - eligibleCount;

    const filtered = departmentCandidates.filter((row) => {
      const matchesSearch = !search || `${row.name_as_in_indos_cert || ''} ${row.cadet_unique_id || ''}`.toLowerCase().includes(search);
      const matchesBatch = !batchYear || String(row.batch_year || '') === batchYear;
      const matchesInstitute = !instituteId || String(row.institute_id || '') === instituteId;
      const matchesEligibility = eligibility === 'all'
        || (eligibility === 'needs_attention' ? !row.eligible : row.eligible);
      return matchesSearch && matchesBatch && matchesInstitute && matchesEligibility;
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;

    res.json({
      success: true,
      data: filtered.slice(start, start + limit),
      meta: {
        page: safePage,
        limit,
        total: filtered.length,
        total_pages: totalPages,
        eligible_count: eligibleCount,
        needs_attention_count: needsAttentionCount,
        selectable_ids: filtered.filter((row) => row.eligible).map((row) => row.id),
        batches,
        institutes,
      },
    });
  } catch (error) { errorResponse(res, error); }
};

const addCandidates = async (req, res) => {
  try {
    const cadetIds = Array.isArray(req.body.cadet_ids) ? req.body.cadet_ids : [];
    const candidates = Array.isArray(req.body.candidates) ? req.body.candidates : [];
    if (!cadetIds.length && !candidates.length) return res.status(400).json({ success: false, message: 'Select at least one candidate' });
    const list = await getRankList(db, req.params.rankListId);
    const added = await addCandidatesService({ rankListId: req.params.rankListId, cadetIds, candidates, userId: req.user.id });
    await logAction(req, 'ADD_CTV_CANDIDATES',
      `Added ${added.length} candidate(s) to ${list.department} allocation ${list.allocation_number}: ${added.map((item) => `${item.cadet_name} (${item.cadet_unique_id || item.cadet_id})`).join(', ')}`);
    res.status(201).json({ success: true, message: 'Candidates added to allocation', data: { added } });
  } catch (error) { errorResponse(res, error); }
};

const removeCandidate = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT a.*,rl.status AS list_status,rl.ranking_mode,ac.deleted_at AS cycle_deleted_at FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id WHERE a.id=? FOR UPDATE`, [req.params.allocationId]);
    if (!rows[0]) throw httpError(404, 'Candidate allocation not found');
    ensureAllocationEnabled(rows[0]);
    if (rows[0].list_status !== 'Draft') throw httpError(409, 'Finalized candidates cannot be removed');
    const [[history]] = await connection.query(`SELECT
      EXISTS(SELECT 1 FROM allocation_workflow_history WHERE allocation_id=?) AS has_history,
      EXISTS(SELECT 1 FROM onboarding WHERE allocation_id=? AND admission_source IS NOT NULL) AS admitted`, [rows[0].id,rows[0].id]);
    if (history.has_history || history.admitted) throw httpError(409, 'This candidate has allocation history and cannot be removed. Cancel the vessel allocation instead.');
    const activityLabel = await allocationActivityLabel(connection, rows[0].id);
    await connection.query(`DELETE FROM allocations WHERE id=?`, [req.params.allocationId]);
    await recalculateRanks(connection, rows[0].rank_list_id);
    await logAction(req, 'REMOVE_CTV_CANDIDATE', `Removed ${activityLabel}`, connection);
    await connection.commit(); res.json({ success: true, message: 'Candidate removed' });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const updateScores = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [allocationRows] = await connection.query(`SELECT a.id,rl.status,ac.deleted_at AS cycle_deleted_at FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id WHERE a.id=? FOR UPDATE`, [req.params.allocationId]);
    if (!allocationRows[0]) throw httpError(404, 'Candidate allocation not found');
    ensureAllocationEnabled(allocationRows[0]);
    if (allocationRows[0].status !== 'Draft') throw httpError(409, 'Assessment scores are locked');
    const scores = Array.isArray(req.body.scores) ? req.body.scores : [];
    const courseIds = scores.map((item) => String(item.course_id || '').trim());
    if (courseIds.some((courseId) => !courseId)) throw httpError(400, 'Select an Assessment Type for every score');
    if (new Set(courseIds).size !== courseIds.length) throw httpError(400, 'Each Assessment Type can be selected only once per cadet');

    const [entries] = await connection.query(`SELECT * FROM allocation_score_entries WHERE allocation_id=?`, [req.params.allocationId]);
    const entriesByCourse = new Map(entries.map((entry) => [entry.course_id, entry]));
    const coursesById = new Map();
    if (courseIds.length) {
      const [courses] = await connection.query(
        `SELECT id,name,status FROM assessment_courses WHERE id IN (?) FOR UPDATE`,
        [courseIds],
      );
      courses.forEach((course) => coursesById.set(course.id, course));
    }

    for (const item of scores) {
      const courseId = String(item.course_id).trim();
      const entry = entriesByCourse.get(courseId);
      const course = coursesById.get(courseId);
      if (!course) throw httpError(400, 'Selected Assessment Type was not found');
      if (course.status !== 'Active' && !entry) throw httpError(400, `${course.name} is no longer active`);

      const value = item.score === '' || item.score === null || item.score === undefined
        ? null
        : Number(item.score);
      if (value === null) throw httpError(400, `${course.name} score is required`);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw httpError(400, `${course.name} score must be between 0 and 100`);
      }

      if (entry) {
        await connection.query(
          `UPDATE allocation_score_entries SET score=?,max_score_snapshot=100,updated_by=? WHERE id=?`,
          [value, req.user.id, entry.id],
        );
      } else {
        await connection.query(
          `INSERT INTO allocation_score_entries
           (id,allocation_id,course_id,course_name_snapshot,max_score_snapshot,weight_snapshot,score,updated_by)
           VALUES (?,?,?,?,100,0,?,?)`,
          [uuidv4(), req.params.allocationId, courseId, course.name, value, req.user.id],
        );
      }
    }

    if (courseIds.length) {
      await connection.query(
        `DELETE FROM allocation_score_entries WHERE allocation_id=? AND course_id NOT IN (?)`,
        [req.params.allocationId, courseIds],
      );
    } else {
      await connection.query(`DELETE FROM allocation_score_entries WHERE allocation_id=?`, [req.params.allocationId]);
    }

    const finalScore = await updateFinalScore(connection, req.params.allocationId, req.user.id);
    const activityLabel = await allocationActivityLabel(connection, req.params.allocationId);
    const scoreChanges = scores.map((item) => {
      const courseId = String(item.course_id).trim();
      const previous = entriesByCourse.get(courseId);
      return `${previous?.course_name_snapshot || coursesById.get(courseId)?.name}: ${previous?.score ?? 'not entered'} to ${Number(item.score)}`;
    });
    entries.filter((entry) => !courseIds.includes(entry.course_id)).forEach((entry) => {
      scoreChanges.push(`${entry.course_name_snapshot}: removed (was ${entry.score ?? 'not entered'})`);
    });
    await logAction(req, 'UPDATE_CTV_SCORES',
      `Updated assessment scores for ${activityLabel}; ${scoreChanges.join('; ') || 'No assessments'}; final score: ${finalScore ?? 'Incomplete'}`, connection);
    await connection.commit(); res.json({ success: true, data: { final_score: finalScore } });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const updateVesselAllocation = (req,res) => require('./joiningWorkflowController').legacySave(req,res);

const moveRank = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { direction, remarks } = req.body;
    if (!remarks?.trim()) throw httpError(400, 'Rank-change remarks are required');
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT a.*,rl.status AS list_status,ac.deleted_at AS cycle_deleted_at FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id WHERE a.id=? FOR UPDATE`, [req.params.allocationId],
    );
    if (!rows[0]) throw httpError(404, 'Candidate allocation not found');
    ensureAllocationEnabled(rows[0]);
    if (rows[0].list_status !== 'Draft') throw httpError(409, 'Ranks are locked');
    if (!rows[0].current_rank) throw httpError(400, 'Complete all candidate scores before changing rank');

    const [rankedRows] = await connection.query(
      `SELECT id,current_rank FROM allocations
       WHERE rank_list_id=? AND is_active=1 AND current_rank IS NOT NULL
       ORDER BY current_rank FOR UPDATE`, [rows[0].rank_list_id],
    );
    const currentRank = Number(rows[0].current_rank);
    const adjacentTarget = ['up','down'].includes(direction) ? currentRank + (direction === 'up' ? -1 : 1) : null;
    const targetRank = Number(req.body.target_rank ?? adjacentTarget);
    let movePlan;
    try { movePlan = createDirectionalRankMovePlan(currentRank, targetRank, rankedRows.length, direction); }
    catch (error) { throw httpError(400, error.message); }

    await connection.query(`UPDATE allocations SET current_rank=0 WHERE id=?`, [rows[0].id]);
    if (movePlan.shiftDelta === 1) {
      await connection.query(
        `UPDATE allocations SET current_rank=current_rank+1
         WHERE rank_list_id=? AND is_active=1 AND current_rank BETWEEN ? AND ?`,
        [rows[0].rank_list_id, movePlan.rangeStart, movePlan.rangeEnd],
      );
    } else {
      await connection.query(
        `UPDATE allocations SET current_rank=current_rank-1
         WHERE rank_list_id=? AND is_active=1 AND current_rank BETWEEN ? AND ?`,
        [rows[0].rank_list_id, movePlan.rangeStart, movePlan.rangeEnd],
      );
    }
    await connection.query(`UPDATE allocations SET current_rank=? WHERE id=?`, [targetRank, rows[0].id]);
    await connection.query(`UPDATE allocation_rank_lists SET ranking_mode='Manual' WHERE id=?`, [rows[0].rank_list_id]);
    await connection.query(
      `INSERT INTO allocation_rank_history (id,rank_list_id,allocation_id,action,from_rank,to_rank,remarks,changed_by) VALUES (?,?,?,?,?,?,?,?)`,
      [uuidv4(), rows[0].rank_list_id, rows[0].id, movePlan.historyAction, currentRank, targetRank, remarks.trim(), req.user.id],
    );
    const activityLabel = await allocationActivityLabel(connection, rows[0].id);
    await logAction(req, 'MOVE_CTV_RANK', `Moved ${activityLabel} from rank ${currentRank} to ${targetRank}; reason: ${remarks.trim()}`, connection);
    await connection.commit(); res.json({ success: true, message: `Rank changed from ${currentRank} to ${targetRank}`, data: { from_rank: currentRank, to_rank: targetRank } });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const resetRanks = async (req, res) => {
  const connection = await db.getConnection();
  try {
    if (!req.body.remarks?.trim()) throw httpError(400, 'Reset remarks are required');
    await connection.beginTransaction(); const list = await getRankList(connection, req.params.rankListId, true); ensureDraft(list);
    await connection.query(`UPDATE allocation_rank_lists SET ranking_mode='Auto' WHERE id=?`, [list.id]);
    await recalculateRanks(connection, list.id, true);
    await connection.query(`INSERT INTO allocation_rank_history (id,rank_list_id,action,remarks,changed_by) VALUES (?,?,'Reset',?,?)`, [uuidv4(), list.id, req.body.remarks.trim(), req.user.id]);
    await logAction(req, 'RESET_CTV_RANKS', `Reset ${list.department} ranks to score order for ${list.allocation_number}; reason: ${req.body.remarks.trim()}`, connection);
    await connection.commit(); res.json({ success: true, message: 'Ranks reset to score order' });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const finalizeRankList = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const list = await getRankList(connection, req.params.rankListId, true); ensureDraft(list);
    const [allocations] = await connection.query(
      `SELECT a.*,c.status AS cadet_status,c.workflow_phase,c.workflow_result
       FROM allocations a JOIN cadets c ON c.id=a.cadet_id
       WHERE a.rank_list_id=? AND a.is_active=1 FOR UPDATE`, [list.id],
    );
    if (!allocations.length) throw httpError(400, 'Add candidates before finalizing the rank list');
    for (const allocation of allocations) {
      const [incomplete] = await connection.query(`SELECT COUNT(*) AS count FROM allocation_score_entries WHERE allocation_id=? AND score IS NULL`, [allocation.id]);
      if (allocation.final_score === null || incomplete[0].count || !allocation.current_rank) throw httpError(400, 'All candidates need complete scores and ranks');
    }
    await connection.query(`UPDATE allocation_rank_lists SET status='Finalized',finalized_by=?,finalized_at=NOW() WHERE id=?`, [req.user.id, list.id]);
    await connection.query(`INSERT INTO allocation_rank_history (id,rank_list_id,action,remarks,changed_by) VALUES (?,?,'Finalize',?,?)`, [uuidv4(), list.id, req.body.remarks || 'Rank list finalized', req.user.id]);
    await logAction(req, 'FINALIZE_CTV_RANK_LIST', `Finalized ${list.department} list for ${list.allocation_number}; ${allocations.length} candidate(s); remarks: ${req.body.remarks?.trim() || 'None'}`, connection);
    await connection.commit();
    res.json({ success: true, message: `${list.department} rank list finalized` });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const unlockRankList = async (req, res) => {
  const connection = await db.getConnection();
  try {
    if (!req.body.remarks?.trim()) throw httpError(400, 'Unlock remarks are required');
    await connection.beginTransaction(); const list = await getRankList(connection, req.params.rankListId, true);
    if (list.status !== 'Finalized') throw httpError(409, 'Only a finalized rank list can be unlocked');
    await connection.query(`UPDATE allocation_rank_lists SET status='Draft',unlocked_by=?,unlocked_at=NOW(),unlock_remarks=? WHERE id=?`, [req.user.id, req.body.remarks.trim(), list.id]);
    await connection.query(`INSERT INTO allocation_rank_history (id,rank_list_id,action,remarks,changed_by) VALUES (?,?,'Unlock',?,?)`, [uuidv4(), list.id, req.body.remarks.trim(), req.user.id]);
    await logAction(req, 'UNLOCK_CTV_RANK_LIST', `Unlocked ${list.department} list for ${list.allocation_number}: ${req.body.remarks.trim()}`, connection);
    await connection.commit();
    res.json({ success: true, message: `${list.department} rank list unlocked` });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const createJoiningPlan = (req,res) => require('./joiningWorkflowController').legacySave(req,res);

const recordCommunication = (req,res) => require('./joiningWorkflowController').record(req,res);

const listJoiningPlans = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT jp.*,a.current_rank,a.allocation_status,a.secondary_allocation_status,c.cadet_unique_id,c.name_as_in_indos_cert,c.email_id,
              rl.department,ac.allocation_number,
              (SELECT mode FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS last_mode,
              (SELECT delivery_status FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS email_delivery_status,
              (SELECT informed_at FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS last_informed_at,
              (SELECT confirmation_received FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 AND cm.delivery_status IS NULL ORDER BY COALESCE(cm.recorded_at,cm.created_at) DESC,cm.id DESC LIMIT 1) AS confirmation_received,
              (SELECT admin_remarks FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS last_admin_remarks,
              (SELECT candidate_remarks FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS last_candidate_remarks,
              (SELECT date_of_informing FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS last_date_of_informing,
              (SELECT failure_reason FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS last_failure_reason,
              (SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ',u.first_name,u.last_name)),''),u.email)
               FROM allocation_communications cm LEFT JOIN users u ON u.id=cm.informed_by
               WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS last_informed_by,
              (SELECT COUNT(*) FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0) AS communication_count,
              (SELECT COUNT(*) FROM allocation_communications cm
               WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0
                 AND cm.mode='Email' AND cm.delivery_status='Sent') AS successful_email_count,
              (SELECT COUNT(*) FROM allocation_communications cm
               WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0
                 AND (cm.mode IN ('Phone','WhatsApp') OR (cm.mode='Email' AND (cm.delivery_status='Sent' OR cm.delivery_status IS NULL)))) AS successful_communication_count
       FROM joining_plans jp JOIN allocations a ON a.id=jp.allocation_id JOIN cadets c ON c.id=a.cadet_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id
       WHERE ac.deleted_at IS NULL AND a.is_active=1 AND (? IS NULL OR ac.id=?) ORDER BY jp.created_at DESC`, [req.query.cycle_id || null, req.query.cycle_id || null],
    );
    rows.forEach((row) => { row.required_documents = parseJson(row.required_documents, []); });
    res.json({ success: true, data: rows });
  } catch (error) { errorResponse(res, error); }
};

const listJoiningPlanCommunications = async (req, res) => {
  try {
    const [plans] = await db.query('SELECT id FROM joining_plans WHERE id=?', [req.params.joiningPlanId]);
    if (!plans.length) throw httpError(404, 'Joining Plan not found');
    const [rows] = await db.query(
      `SELECT cm.id,cm.plan_revision,cm.mode,cm.informed_by,
              DATE_FORMAT(cm.date_of_informing,'%Y-%m-%d') AS date_of_informing,
              cm.informed_at,cm.confirmation_received,cm.candidate_remarks,cm.admin_remarks,
              cm.delivery_status,cm.failure_reason,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ',u.first_name,u.last_name)),''),u.email) AS informed_by_name
       FROM allocation_communications cm
       LEFT JOIN users u ON u.id=cm.informed_by
       WHERE cm.joining_plan_id=? ORDER BY cm.created_at DESC,cm.id DESC`,
      [req.params.joiningPlanId],
    );
    res.json({ success: true, data: rows });
  } catch (error) { errorResponse(res, error); }
};

const listAdmins = async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT id,email,first_name,last_name,role FROM users WHERE status='active' AND LOWER(role) IN ('admin','superadmin') ORDER BY first_name,last_name,email`);
    res.json({ success: true, data: rows });
  } catch (error) { errorResponse(res, error); }
};

module.exports = {
  listCycles, getCycle, createCycle, deleteCycle, listEligibleCandidates, addCandidates,
  removeCandidate, updateScores, updateVesselAllocation, moveRank, resetRanks,
  finalizeRankList, unlockRankList, createJoiningPlan, recordCommunication, listJoiningPlans, listJoiningPlanCommunications, listAdmins,
};
