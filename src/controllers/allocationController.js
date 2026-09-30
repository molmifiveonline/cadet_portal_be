const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../services/emailService');
const activityLogDao = require('../dao/activityLogDao');
const { normalizeDepartment, isDepartmentCompatible, hasAllocatedVessel, createDirectionalRankMovePlan } = require('../services/allocationRules');
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
            AND (informed_cm.mode IN ('Phone','WhatsApp') OR informed_cm.delivery_status='Sent')
        ) THEN a.id END) AS informed_count,
        COUNT(DISTINCT CASE WHEN a.is_active=1 AND o.status='Onboarded' THEN a.id END) AS onboarded_count
       FROM allocation_cycles ac
       JOIN allocation_rank_lists rl ON rl.cycle_id=ac.id
       LEFT JOIN allocations a ON a.rank_list_id=rl.id
       LEFT JOIN joining_plans jp ON jp.allocation_id=a.id
       LEFT JOIN onboarding o ON o.allocation_id=a.id
       GROUP BY ac.id ORDER BY ac.allocation_year DESC, ac.created_at DESC`,
    );
    res.json({ success: true, data: rows });
  } catch (error) { errorResponse(res, error); }
};

const hydrateCycle = async (cycleId) => {
  const [cycles] = await db.query(`SELECT * FROM allocation_cycles WHERE id=?`, [cycleId]);
  if (!cycles[0]) throw httpError(404, 'Allocation cycle not found');
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
              o.id AS onboarding_id, o.status AS onboarding_status,
              (COALESCE(o.passport_verified,0) + COALESCE(o.medical_cert_verified,0)
                + COALESCE(o.bank_details_verified,0) + COALESCE(o.agreement_signed,0)
                + COALESCE(o.final_clearance,0)) AS onboarding_completed_checks,
              EXISTS(
                SELECT 1 FROM joining_plans ijp
                JOIN allocation_communications ic ON ic.joining_plan_id=ijp.id
                WHERE ijp.allocation_id=a.id
                  AND ijp.requires_refresh=0 AND ic.plan_revision=ijp.revision
                  AND (ic.mode IN ('Phone','WhatsApp') OR ic.delivery_status='Sent')
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

const deleteCycle = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [cycles] = await connection.query(
      `SELECT id,allocation_number,department,status FROM allocation_cycles WHERE id=? FOR UPDATE`,
      [req.params.id],
    );
    if (!cycles[0]) throw httpError(404, 'Allocation cycle not found');

    const [finalizedLists] = await connection.query(
      `SELECT department FROM allocation_rank_lists WHERE cycle_id=? AND status='Finalized' FOR UPDATE`,
      [req.params.id],
    );
    if (finalizedLists.length) {
      throw httpError(
        409,
        `Cannot delete this cycle because the ${finalizedLists.map((list) => list.department).join(' and ')} Rank List is finalized`,
      );
    }

    const [joiningPlans] = await connection.query(
      `SELECT jp.id FROM joining_plans jp
       JOIN allocations a ON a.id=jp.allocation_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       WHERE rl.cycle_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id],
    );
    if (joiningPlans.length) throw httpError(409, 'Cannot delete a cycle that has a Joining Plan');

    const [onboardingRecords] = await connection.query(
      `SELECT o.id FROM onboarding o
       JOIN allocations a ON a.id=o.allocation_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       WHERE rl.cycle_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id],
    );
    if (onboardingRecords.length) throw httpError(409, 'Cannot delete a cycle that has Onboarding records');

    await connection.query(`DELETE FROM allocation_cycles WHERE id=?`, [req.params.id]);
    await logAction(req, 'DELETE_CTV_ALLOCATION', `Deleted ${cycles[0].department} allocation cycle ${cycles[0].allocation_number}`, connection);
    await connection.commit();
    res.json({ success: true, message: `${cycles[0].allocation_number} deleted` });
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
                     WHERE ax.cadet_id=c.id AND ax.is_active=1 AND acx.status='Active') AS already_allocated
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
    const [rows] = await connection.query(`SELECT a.*,rl.status AS list_status,rl.ranking_mode FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id WHERE a.id=? FOR UPDATE`, [req.params.allocationId]);
    if (!rows[0]) throw httpError(404, 'Candidate allocation not found');
    if (rows[0].list_status !== 'Draft') throw httpError(409, 'Finalized candidates cannot be removed');
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
    const [allocationRows] = await connection.query(`SELECT a.id,rl.status FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id WHERE a.id=? FOR UPDATE`, [req.params.allocationId]);
    if (!allocationRows[0]) throw httpError(404, 'Candidate allocation not found');
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

const updateVesselAllocation = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT a.*,rl.department,rl.status AS list_status FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id WHERE a.id=? FOR UPDATE`, [req.params.allocationId],
    );
    if (!rows[0]) throw httpError(404, 'Candidate allocation not found');
    const allocation = rows[0];
    const [onboarding] = await connection.query('SELECT status FROM onboarding WHERE allocation_id=? FOR UPDATE', [allocation.id]);
    if (onboarding[0]?.status === 'Onboarded') throw httpError(409, 'Vessel assignments cannot change after onboarding is complete');
    const allowedStatuses = ['Pending','Allocated','Hold','Cancelled'];
    const primaryStatus = req.body.primary_allocation_status || req.body.allocation_status || 'Pending';
    const secondaryStatus = req.body.secondary_allocation_status || 'Pending';
    if (!allowedStatuses.includes(primaryStatus) || !allowedStatuses.includes(secondaryStatus)) throw httpError(400, 'Invalid vessel allocation status');

    const primaryVesselId = req.body.vessel_id || null;
    const secondaryVesselId = req.body.secondary_vessel_id || null;
    if (primaryVesselId && secondaryVesselId && primaryVesselId === secondaryVesselId) throw httpError(400, 'Primary and Secondary must be different vessels');

    const vesselIds = [primaryVesselId, secondaryVesselId].filter(Boolean).sort();
    const [vessels] = vesselIds.length
      ? await connection.query(`SELECT * FROM vessels WHERE id IN (?) ORDER BY id FOR UPDATE`, [vesselIds])
      : [[]];
    const vesselsById = new Map(vessels.map((vessel) => [vessel.id, vessel]));

    const requestedTypeIds = [...new Set([
      req.body.vessel_type_id,
      req.body.secondary_vessel_type_id,
      ...vessels.map((vessel) => vessel.vessel_type_id),
    ].filter(Boolean))];
    const [types] = requestedTypeIds.length
      ? await connection.query(`SELECT * FROM vessel_types WHERE id IN (?)`, [requestedTypeIds])
      : [[]];
    const typesById = new Map(types.map((type) => [type.id, type]));

    const slots = [
      { label: 'Primary', vesselId: primaryVesselId, typeId: req.body.vessel_type_id || null, status: primaryStatus },
      { label: 'Secondary', vesselId: secondaryVesselId, typeId: req.body.secondary_vessel_type_id || null, status: secondaryStatus },
    ];
    for (const slot of slots) {
      const reservesSeat = ['Allocated','Hold'].includes(slot.status);
      if (reservesSeat && !slot.vesselId) throw httpError(400, `${slot.label} status ${slot.status} requires an actual vessel`);
      if (!slot.vesselId && !slot.typeId) continue;

      const vessel = slot.vesselId ? vesselsById.get(slot.vesselId) : null;
      if (slot.vesselId && (!vessel || vessel.status !== 'Active')) throw httpError(400, `Select an active ${slot.label.toLowerCase()} vessel`);
      if (vessel && !isDepartmentCompatible(allocation.department, vessel.department)) throw httpError(400, `${slot.label} vessel is not available for this candidate department`);
      slot.typeId ||= vessel?.vessel_type_id || null;
      const type = slot.typeId ? typesById.get(slot.typeId) : null;
      if (!type || type.status !== 'Active' || !isDepartmentCompatible(allocation.department, type.department)) throw httpError(400, `${slot.label} vessel type is incompatible`);
      if (vessel && vessel.vessel_type_id !== type.id) throw httpError(400, `${slot.label} vessel does not match its selected vessel type`);

      if (reservesSeat) {
        if (!(Number(vessel.total_seats) > 0)) throw httpError(409, `${slot.label} vessel has no allocatable seats`);
        const [counts] = await connection.query(
          `SELECT COALESCE(SUM(
             (vessel_id=? AND allocation_status IN ('Allocated','Hold'))
             + (secondary_vessel_id=? AND secondary_allocation_status IN ('Allocated','Hold'))
           ),0) AS reserved
           FROM allocations WHERE is_active=1 AND id<>?`,
          [vessel.id, vessel.id, allocation.id],
        );
        if (Number(counts[0].reserved) >= Number(vessel.total_seats)) throw httpError(409, `No seats remain on ${slot.label.toLowerCase()} vessel`);
      }
    }
    await connection.query(
      `UPDATE allocations
       SET vessel_type_id=?,vessel_id=?,allocation_status=?,
           secondary_vessel_type_id=?,secondary_vessel_id=?,secondary_allocation_status=?,admin_remarks=?
       WHERE id=?`,
      [slots[0].typeId, primaryVesselId, primaryStatus, slots[1].typeId, secondaryVesselId, secondaryStatus, req.body.admin_remarks || null, allocation.id],
    );
    const changedRoles = slots.filter((slot, index) => {
      const previousVessel = index ? allocation.secondary_vessel_id : allocation.vessel_id;
      const previousType = index ? allocation.secondary_vessel_type_id : allocation.vessel_type_id;
      const previousStatus = index ? allocation.secondary_allocation_status : allocation.allocation_status;
      return slot.vesselId !== previousVessel || slot.typeId !== previousType || slot.status !== previousStatus;
    }).map((slot) => slot.label);
    if (changedRoles.length) {
      await connection.query(
        "UPDATE joining_plans SET status='Needs Review',requires_refresh=1 WHERE allocation_id=? AND vessel_role IN (?)",
        [allocation.id, changedRoles],
      );
    }
    if (allocation.list_status === 'Finalized') {
      const allocated = hasAllocatedVessel({ primaryVesselId, primaryStatus, secondaryVesselId, secondaryStatus });
      await connection.query(
        `UPDATE cadets SET status=?,workflow_phase=?,workflow_result=?,workflow_updated_at=NOW() WHERE id=?`,
        [allocated ? 'CTV Assigned' : (allocation.previous_cadet_status || 'Selected'),
          allocated ? 'selected' : (allocation.previous_workflow_phase || 'selected'),
          allocated ? 'ctv_assigned' : allocation.previous_workflow_result, allocation.cadet_id],
      );
    }
    const activityLabel = await allocationActivityLabel(connection, allocation.id);
    const assignments = slots.map((slot) =>
      `${slot.label}: ${vesselsById.get(slot.vesselId)?.name || 'No vessel'} / ${typesById.get(slot.typeId)?.name || 'No type'} (${slot.status})`,
    ).join('; ');
    await logAction(req, 'UPDATE_CTV_VESSEL_ALLOCATION', `Updated vessel assignments for ${activityLabel}; ${assignments}${changedRoles.length ? `; joining plans for changed slots require review` : ''}`, connection);
    await connection.commit(); res.json({ success: true, message: 'Vessel allocation updated' });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const moveRank = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { direction, remarks } = req.body;
    if (!remarks?.trim()) throw httpError(400, 'Rank-change remarks are required');
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT a.*,rl.status AS list_status FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id WHERE a.id=? FOR UPDATE`, [req.params.allocationId],
    );
    if (!rows[0]) throw httpError(404, 'Candidate allocation not found');
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
      await connection.query(
        `UPDATE allocations SET previous_cadet_status=COALESCE(previous_cadet_status,?),previous_workflow_phase=COALESCE(previous_workflow_phase,?),previous_workflow_result=COALESCE(previous_workflow_result,?) WHERE id=?`,
        [allocation.cadet_status, allocation.workflow_phase, allocation.workflow_result, allocation.id],
      );
      if (hasAllocatedVessel({ primaryVesselId: allocation.vessel_id, primaryStatus: allocation.allocation_status,
        secondaryVesselId: allocation.secondary_vessel_id, secondaryStatus: allocation.secondary_allocation_status })) {
        await connection.query(`UPDATE cadets SET status='CTV Assigned',workflow_phase='selected',workflow_result='ctv_assigned',workflow_updated_at=NOW() WHERE id=?`, [allocation.cadet_id]);
      }
      await connection.query(
        `INSERT INTO onboarding (id,cadet_id,allocation_id,status) SELECT ?,?,?, 'Pending'
         WHERE NOT EXISTS (SELECT 1 FROM onboarding WHERE allocation_id=?)`, [uuidv4(), allocation.cadet_id, allocation.id, allocation.id],
      );
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
    const [completed] = await connection.query(
      `SELECT COUNT(*) AS count FROM onboarding o JOIN allocations a ON a.id=o.allocation_id WHERE a.rank_list_id=? AND o.status='Onboarded' FOR UPDATE`, [list.id],
    );
    if (completed[0].count) throw httpError(409, 'This list cannot be unlocked because onboarding is complete for one or more candidates');
    await connection.query(
      `UPDATE cadets c JOIN allocations a ON a.cadet_id=c.id
       SET c.status=COALESCE(a.previous_cadet_status,'Selected'),
           c.workflow_phase=COALESCE(a.previous_workflow_phase,'selected'),
           c.workflow_result=COALESCE(a.previous_workflow_result,'medical_passed'),c.workflow_updated_at=NOW()
       WHERE a.rank_list_id=? AND a.is_active=1`, [list.id],
    );
    await connection.query(`UPDATE joining_plans jp JOIN allocations a ON a.id=jp.allocation_id SET jp.status='Needs Review',jp.requires_refresh=1 WHERE a.rank_list_id=?`, [list.id]);
    await connection.query(`UPDATE allocation_rank_lists SET status='Draft',unlocked_by=?,unlocked_at=NOW(),unlock_remarks=? WHERE id=?`, [req.user.id, req.body.remarks.trim(), list.id]);
    await connection.query(`INSERT INTO allocation_rank_history (id,rank_list_id,action,remarks,changed_by) VALUES (?,?,'Unlock',?,?)`, [uuidv4(), list.id, req.body.remarks.trim(), req.user.id]);
    await logAction(req, 'UNLOCK_CTV_RANK_LIST', `Unlocked ${list.department} list for ${list.allocation_number}: ${req.body.remarks.trim()}`, connection);
    await connection.commit();
    res.json({ success: true, message: `${list.department} rank list unlocked` });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const createJoiningPlan = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const vesselRole = req.body.vessel_role || 'Primary';
    if (!['Primary','Secondary'].includes(vesselRole)) throw httpError(400, 'Vessel role must be Primary or Secondary');
    const [rows] = await connection.query(
      `SELECT a.id AS allocation_id,rl.status AS list_status,
              a.allocation_status,a.secondary_allocation_status,
              pv.id AS primary_id,pv.name AS primary_name,pv.vessel_type AS primary_type_text,
              pv.location AS primary_location,pv.joining_date AS primary_joining_date,pv.total_seats AS primary_total_seats,
              pv.voyage_ref AS primary_voyage_ref,pv.reporting_port AS primary_reporting_port,
              pv.contact_person_name AS primary_contact_name,pv.contact_person_email AS primary_contact_email,
              pv.contact_person_phone AS primary_contact_phone,
              pv.required_documents AS primary_documents,pvt.name AS primary_type_name,
              sv.id AS secondary_id,sv.name AS secondary_name,sv.vessel_type AS secondary_type_text,
              sv.location AS secondary_location,sv.joining_date AS secondary_joining_date,sv.total_seats AS secondary_total_seats,
              sv.voyage_ref AS secondary_voyage_ref,sv.reporting_port AS secondary_reporting_port,
              sv.contact_person_name AS secondary_contact_name,sv.contact_person_email AS secondary_contact_email,
              sv.contact_person_phone AS secondary_contact_phone,
              sv.required_documents AS secondary_documents,svt.name AS secondary_type_name
       FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       LEFT JOIN vessels pv ON pv.id=a.vessel_id LEFT JOIN vessel_types pvt ON pvt.id=pv.vessel_type_id
       LEFT JOIN vessels sv ON sv.id=a.secondary_vessel_id LEFT JOIN vessel_types svt ON svt.id=sv.vessel_type_id
       WHERE a.id=? AND a.is_active=1 FOR UPDATE`, [req.params.allocationId],
    );
    const allocation = rows[0];
    if (!allocation) throw httpError(404, 'Candidate allocation not found');
    const prefix = vesselRole.toLowerCase();
    if (allocation[`${prefix}_id`] === null || allocation[vesselRole === 'Primary' ? 'allocation_status' : 'secondary_allocation_status'] !== 'Allocated') {
      throw httpError(400, `${vesselRole} vessel must be Allocated before creating its Joining Plan`);
    }
    const requestedDocuments = Array.isArray(req.body.required_documents)
      ? req.body.required_documents
      : String(req.body.required_documents || '').split(/[\n,]/);
    const item = {
      allocation_id: allocation.allocation_id,
      name: allocation[`${prefix}_name`],
      type_name: allocation[`${prefix}_type_name`],
      vessel_type: allocation[`${prefix}_type_text`],
      location: String(req.body.location ?? allocation[`${prefix}_location`] ?? '').trim() || null,
      joining_date: String(req.body.joining_date ?? allocation[`${prefix}_joining_date`] ?? '').trim(),
      total_seats: allocation[`${prefix}_total_seats`],
      voyage_ref: String(req.body.voyage_ref ?? allocation[`${prefix}_voyage_ref`] ?? '').trim() || null,
      reporting_port: String(req.body.reporting_port ?? allocation[`${prefix}_reporting_port`] ?? '').trim(),
      contact_person_name: String(req.body.contact_person_name ?? allocation[`${prefix}_contact_name`] ?? '').trim(),
      contact_person_email: String(req.body.contact_person_email ?? allocation[`${prefix}_contact_email`] ?? '').trim() || null,
      contact_person_phone: String(req.body.contact_person_phone ?? allocation[`${prefix}_contact_phone`] ?? '').trim() || null,
      communication_details: String(req.body.communication_details ?? '').trim() || null,
      required_documents: requestedDocuments.map((document) => String(document).trim()).filter(Boolean),
    };
    if (allocation.list_status !== 'Finalized') throw httpError(409, 'Finalize the department rank list before creating a Joining Plan');
    if (!isValidIsoDate(item.joining_date)) {
      throw httpError(400, 'A valid Joining Date is required');
    }
    if (!item.reporting_port) throw httpError(400, 'Reporting Port is required');
    if (!item.contact_person_name) throw httpError(400, 'Contact Person is required');
    if (item.contact_person_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.contact_person_email)) throw httpError(400, 'Contact Person email is invalid');
    const activityLabel = await allocationActivityLabel(connection, item.allocation_id);
    const id = uuidv4();
    const [existingPlans] = await connection.query('SELECT * FROM joining_plans WHERE allocation_id=? AND vessel_role=? FOR UPDATE', [item.allocation_id, vesselRole]);
    const existingPlan = existingPlans[0];
    if (existingPlan?.requires_refresh) {
      await connection.query(
        `UPDATE joining_plans SET status='Draft',requires_refresh=0,revision=revision+1,
         vessel_name=?,vessel_type=?,location=?,joining_date=?,total_seats=?,voyage_ref=?,reporting_port=?,
         contact_person_name=?,contact_person_email=?,contact_person_phone=?,communication_details=?,required_documents=? WHERE id=?`,
        [item.name,item.type_name || item.vessel_type,item.location,item.joining_date,item.total_seats,item.voyage_ref,item.reporting_port,
          item.contact_person_name,item.contact_person_email,item.contact_person_phone,item.communication_details,JSON.stringify(item.required_documents),existingPlan.id],
      );
      await logAction(req, 'UPDATE_CTV_JOINING_PLAN',
        `Updated ${vesselRole} Joining Plan for ${activityLabel}; vessel: ${existingPlan.vessel_name} to ${item.name}; joining date: ${item.joining_date}; previous contact history retained`, connection);
    } else if (!existingPlan) {
      await connection.query(
      `INSERT INTO joining_plans (id,allocation_id,vessel_role,status,vessel_name,vessel_type,location,joining_date,total_seats,voyage_ref,reporting_port,contact_person_name,contact_person_email,contact_person_phone,communication_details,required_documents,created_by)
       VALUES (?,?,?, 'Draft',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, item.allocation_id, vesselRole, item.name, item.type_name || item.vessel_type, item.location, item.joining_date, item.total_seats, item.voyage_ref, item.reporting_port, item.contact_person_name, item.contact_person_email, item.contact_person_phone, item.communication_details, JSON.stringify(item.required_documents), req.user.id],
      );
      await logAction(req, 'CREATE_CTV_JOINING_PLAN',
        `Created ${vesselRole} Joining Plan for ${activityLabel}; vessel: ${item.name}; joining date: ${item.joining_date}; reporting port: ${item.reporting_port}`, connection);
    }
    const [plans] = await connection.query(`SELECT * FROM joining_plans WHERE allocation_id=? AND vessel_role=?`, [item.allocation_id, vesselRole]);
    await connection.commit();
    res.status(201).json({ success: true, data: plans[0] });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
const isValidIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const recordCommunication = async (req, res) => {
  try {
    const { mode, informed_by, date_of_informing, confirmation_received, candidate_remarks, admin_remarks } = req.body;
    if (!['Email','Phone','WhatsApp'].includes(mode)) throw httpError(400, 'Select Email, Phone, or WhatsApp');
    if (!date_of_informing || !isValidIsoDate(String(date_of_informing))) throw httpError(400, 'Select a valid Date of Informing');
    if (String(date_of_informing) > new Date().toISOString().slice(0, 10)) throw httpError(400, 'Date of Informing cannot be in the future');
    const informedBy = informed_by || req.user.id;
    const [users] = await db.query(`SELECT id FROM users WHERE id=? AND status='active' AND LOWER(role) IN ('admin','superadmin')`, [informedBy]);
    if (!users[0]) throw httpError(400, 'Informed By must be an active Admin or Super Admin');
    const [rows] = await db.query(
      `SELECT jp.*,a.cadet_id,c.name_as_in_indos_cert,c.email_id,c.cadet_unique_id,rl.department,ac.allocation_number
       FROM joining_plans jp JOIN allocations a ON a.id=jp.allocation_id JOIN cadets c ON c.id=a.cadet_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       JOIN allocation_cycles ac ON ac.id=rl.cycle_id
       WHERE jp.id=? AND rl.status='Finalized'`, [req.params.joiningPlanId],
    );
    const plan = rows[0]; if (!plan) throw httpError(404, 'Finalized Joining Plan not found');
    if (plan.requires_refresh) throw httpError(409, 'Update this Joining Plan for the current vessel assignment before recording intimation');
    let deliveryStatus = null; let messageId = null; let failureReason = null;
    if (mode === 'Email') {
      if (!plan.email_id) throw httpError(400, 'Candidate email address is missing');
      const documents = parseJson(plan.required_documents, []);
      try {
        const result = await sendEmail({
          to: plan.email_id,
          subject: `Joining Intimation - ${plan.vessel_name}`,
          html: `<p>Dear ${escapeHtml(plan.name_as_in_indos_cert)},</p>
            <p>Your CTV vessel joining details are below.</p>
            <table border="1" cellpadding="7" cellspacing="0" style="border-collapse:collapse">
              <tr><th align="left">Vessel</th><td>${escapeHtml(plan.vessel_name)}</td></tr>
              <tr><th align="left">Vessel Type</th><td>${escapeHtml(plan.vessel_type || '-')}</td></tr>
              <tr><th align="left">Joining Date</th><td>${escapeHtml(plan.joining_date || 'TBD')}</td></tr>
              <tr><th align="left">Reporting Location</th><td>${escapeHtml(plan.reporting_port || plan.location || '-')}</td></tr>
              <tr><th align="left">Voyage Reference</th><td>${escapeHtml(plan.voyage_ref || '-')}</td></tr>
              <tr><th align="left">Contact Person</th><td>${escapeHtml(plan.contact_person_name || '-')} ${escapeHtml(plan.contact_person_phone || '')} ${escapeHtml(plan.contact_person_email || '')}</td></tr>
            </table>
            <p><strong>Required Documents:</strong> ${escapeHtml(documents.length ? documents.join(', ') : 'As advised by the administration')}</p>
            <p>${escapeHtml(plan.communication_details || '')}</p>`,
        });
        deliveryStatus = 'Sent'; messageId = result.messageId || null;
      } catch (error) { deliveryStatus = 'Failed'; failureReason = error.message; }
    }
    const communicationId = uuidv4();
    await db.query(
      `INSERT INTO allocation_communications (id,joining_plan_id,plan_revision,informed_by,date_of_informing,mode,confirmation_received,candidate_remarks,admin_remarks,delivery_status,email_message_id,failure_reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [communicationId, plan.id, plan.revision, informedBy, date_of_informing || new Date(), mode, confirmation_received ? 1 : 0, candidate_remarks || null, admin_remarks || null, deliveryStatus, messageId, failureReason],
    );
    await db.query(`UPDATE joining_plans SET status=? WHERE id=? AND revision=? AND requires_refresh=0`, [deliveryStatus === 'Failed' ? 'Needs Review' : (confirmation_received ? 'Confirmed' : 'Informed'), plan.id, plan.revision]);
    await logAction(req, deliveryStatus === 'Failed' ? 'CTV_COMMUNICATION_FAILED' : 'RECORD_CTV_COMMUNICATION',
      `${deliveryStatus === 'Failed' ? 'Failed Email attempt' : `Recorded ${mode} communication`} for ${plan.name_as_in_indos_cert} (${plan.cadet_unique_id}) in ${plan.department} allocation ${plan.allocation_number}; ${plan.vessel_role} vessel: ${plan.vessel_name}; informed by: ${informedBy}; date: ${date_of_informing}; confirmed: ${confirmation_received ? 'Yes' : 'No'}; delivery: ${deliveryStatus || 'Recorded'}`);
    const responseStatus = deliveryStatus === 'Failed' ? 502 : 201;
    res.status(responseStatus).json({ success: deliveryStatus !== 'Failed', message: deliveryStatus === 'Failed' ? 'Email failed; the failed attempt was recorded' : 'Communication recorded', data: { id: communicationId, delivery_status: deliveryStatus, failure_reason: failureReason } });
  } catch (error) { errorResponse(res, error); }
};

const listJoiningPlans = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT jp.*,a.current_rank,a.allocation_status,a.secondary_allocation_status,c.cadet_unique_id,c.name_as_in_indos_cert,c.email_id,
              rl.department,ac.allocation_number,
              (SELECT mode FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS last_mode,
              (SELECT delivery_status FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS email_delivery_status,
              (SELECT informed_at FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS last_informed_at,
              (SELECT confirmation_received FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND jp.requires_refresh=0 ORDER BY cm.created_at DESC LIMIT 1) AS confirmation_received,
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
                 AND (cm.mode IN ('Phone','WhatsApp') OR cm.delivery_status='Sent')) AS successful_communication_count
       FROM joining_plans jp JOIN allocations a ON a.id=jp.allocation_id JOIN cadets c ON c.id=a.cadet_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id
       WHERE (? IS NULL OR ac.id=?) ORDER BY jp.created_at DESC`, [req.query.cycle_id || null, req.query.cycle_id || null],
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
