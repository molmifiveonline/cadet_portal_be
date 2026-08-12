const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../services/emailService');
const activityLogDao = require('../dao/activityLogDao');
const { normalizeDepartment, hasAllocatedVessel, createRankMovePlan } = require('../services/allocationRules');
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

const logAction = (req, action, details) => activityLogDao.createLog(req.user?.id, action, details, req.ip || req.connection?.remoteAddress);

const listCycles = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ac.*,
        MAX(CASE WHEN rl.department='Deck' THEN rl.status END) AS deck_status,
        MAX(CASE WHEN rl.department='Engine' THEN rl.status END) AS engine_status,
        COUNT(DISTINCT CASE WHEN a.is_active=1 THEN a.id END) AS candidate_count,
        SUM(CASE WHEN a.is_active=1 AND (a.allocation_status='Allocated' OR a.secondary_allocation_status='Allocated') THEN 1 ELSE 0 END) AS allocated_count
       FROM allocation_cycles ac
       JOIN allocation_rank_lists rl ON rl.cycle_id=ac.id
       LEFT JOIN allocations a ON a.rank_list_id=rl.id
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
    const [allocations] = await db.query(
      `SELECT a.*, c.cadet_unique_id, c.name_as_in_indos_cert, c.email_id, c.course, c.batch_year,
              i.institute_name, vt.name AS vessel_type_name, svt.name AS secondary_vessel_type_name,
              v.name AS vessel_name, v.total_seats, v.joining_date, v.location, v.voyage_ref, v.reporting_port,
              sv.name AS secondary_vessel_name, sv.total_seats AS secondary_total_seats,
              sv.joining_date AS secondary_joining_date, sv.location AS secondary_location,
              sv.voyage_ref AS secondary_voyage_ref, sv.reporting_port AS secondary_reporting_port,
              pjp.id AS primary_joining_plan_id, pjp.status AS primary_joining_plan_status,
              sjp.id AS secondary_joining_plan_id, sjp.status AS secondary_joining_plan_status
       FROM allocations a JOIN cadets c ON c.id=a.cadet_id
       LEFT JOIN institutes i ON i.id=c.institute_id
       LEFT JOIN vessel_types vt ON vt.id=a.vessel_type_id
       LEFT JOIN vessel_types svt ON svt.id=a.secondary_vessel_type_id
       LEFT JOIN vessels v ON v.id=a.vessel_id
       LEFT JOIN vessels sv ON sv.id=a.secondary_vessel_id
       LEFT JOIN joining_plans pjp ON pjp.allocation_id=a.id AND pjp.vessel_role='Primary'
       LEFT JOIN joining_plans sjp ON sjp.allocation_id=a.id AND sjp.vessel_role='Secondary'
       WHERE a.rank_list_id=? AND a.is_active=1
       ORDER BY a.current_rank IS NULL, a.current_rank, c.cadet_unique_id`, [list.id],
    );
    if (allocations.length) {
      const [scores] = await db.query(
        `SELECT * FROM allocation_score_entries WHERE allocation_id IN (?) ORDER BY created_at`, [allocations.map((item) => item.id)],
      );
      const grouped = scores.reduce((map, score) => { (map[score.allocation_id] ||= []).push(score); return map; }, {});
      allocations.forEach((allocation) => {
        allocation.scores = grouped[allocation.id] || [];
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
    const { year } = req.body;
    const data = await createCycleService({ year, userId: req.user.id });
    await logAction(req, 'CREATE_CTV_ALLOCATION', `Created allocation cycle ${data.allocation_number}`);
    res.status(201).json({ success: true, data });
  } catch (error) { errorResponse(res, error); }
};

const listEligibleCandidates = async (req, res) => {
  try {
    const rankList = await getRankList(db, req.params.rankListId);
    const params = [];
    let where = `WHERE (c.workflow_phase='selected' OR c.status IN ('Selected','Medical Completed','CTV Assigned'))`;
    if (req.query.batch_year) { where += ' AND c.batch_year=?'; params.push(req.query.batch_year); }
    if (req.query.institute_id) { where += ' AND c.institute_id=?'; params.push(req.query.institute_id); }
    if (req.query.search) {
      where += ' AND (c.name_as_in_indos_cert LIKE ? OR c.cadet_unique_id LIKE ?)';
      params.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }
    const [rows] = await db.query(
      `SELECT c.id, c.cadet_unique_id, c.name_as_in_indos_cert, c.course, c.batch_year,
              c.imu_avg_all_semester_percentage AS academic_score, i.institute_name,
              dv.status AS document_verification_status, dv.remarks AS verification_remarks,
              EXISTS(SELECT 1 FROM allocations ax JOIN allocation_rank_lists rlx ON rlx.id=ax.rank_list_id
                     JOIN allocation_cycles acx ON acx.id=rlx.cycle_id
                     WHERE ax.cadet_id=c.id AND ax.is_active=1 AND acx.status='Active') AS already_allocated
       FROM cadets c LEFT JOIN institutes i ON i.id=c.institute_id
       LEFT JOIN document_verifications dv ON dv.cadet_id=c.id
       ${where} ORDER BY c.batch_year DESC, i.institute_name, c.name_as_in_indos_cert`, params,
    );
    const data = rows.filter((row) => normalizeDepartment(row.course) === rankList.department).map((row) => {
      const academic = Number(row.academic_score);
      const reasons = [];
      if (row.document_verification_status !== 'Verified') reasons.push('Document verification is not complete');
      if (!Number.isFinite(academic) || academic < 0 || academic > 100) reasons.push('IMU academic score is missing or invalid');
      if (row.already_allocated) reasons.push('Candidate already belongs to an active allocation');
      return { ...row, eligible: reasons.length === 0, ineligible_reasons: reasons };
    });
    res.json({ success: true, data });
  } catch (error) { errorResponse(res, error); }
};

const verifyDocuments = async (req, res) => {
  try {
    const status = req.body.status || 'Verified';
    if (!['Pending','Verified','Revoked'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid document verification status' });
    if (status !== 'Pending' && !req.body.remarks?.trim()) return res.status(400).json({ success: false, message: 'Verification remarks are required' });
    const [cadets] = await db.query(`SELECT id, name_as_in_indos_cert, workflow_phase, status FROM cadets WHERE id=?`, [req.params.cadetId]);
    if (!cadets[0]) throw httpError(404, 'Candidate not found');
    if (!(cadets[0].workflow_phase === 'selected' || ['Selected','Medical Completed'].includes(cadets[0].status))) throw httpError(400, 'Only selected/document-stage candidates can be verified');
    await db.query(
      `INSERT INTO document_verifications (id,cadet_id,status,remarks,verified_by,verified_at)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status),remarks=VALUES(remarks),verified_by=VALUES(verified_by),verified_at=VALUES(verified_at)`,
      [uuidv4(), req.params.cadetId, status, req.body.remarks || null, req.user.id, status === 'Verified' ? new Date() : null],
    );
    await logAction(req, 'VERIFY_CADET_DOCUMENTS', `${status} document verification for ${cadets[0].name_as_in_indos_cert}: ${req.body.remarks || ''}`);
    res.json({ success: true, message: `Document verification marked ${status}` });
  } catch (error) { errorResponse(res, error); }
};

const addCandidates = async (req, res) => {
  try {
    if (!Array.isArray(req.body.cadet_ids) || !req.body.cadet_ids.length) return res.status(400).json({ success: false, message: 'Select at least one candidate' });
    await addCandidatesService({ rankListId: req.params.rankListId, cadetIds: req.body.cadet_ids, userId: req.user.id });
    res.status(201).json({ success: true, message: 'Candidates added to allocation' });
  } catch (error) { errorResponse(res, error); }
};

const removeCandidate = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT a.*,rl.status AS list_status,rl.ranking_mode FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id WHERE a.id=? FOR UPDATE`, [req.params.allocationId]);
    if (!rows[0]) throw httpError(404, 'Candidate allocation not found');
    if (rows[0].list_status !== 'Draft') throw httpError(409, 'Finalized candidates cannot be removed');
    await connection.query(`DELETE FROM allocations WHERE id=?`, [req.params.allocationId]);
    if (rows[0].ranking_mode === 'Manual' && rows[0].current_rank) {
      await connection.query(`UPDATE allocations SET current_rank=current_rank-1 WHERE rank_list_id=? AND is_active=1 AND current_rank>?`, [rows[0].rank_list_id, rows[0].current_rank]);
    } else {
      await recalculateRanks(connection, rows[0].rank_list_id, true);
    }
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
    const [entries] = await connection.query(`SELECT * FROM allocation_score_entries WHERE allocation_id=?`, [req.params.allocationId]);
    const entriesByCourse = new Map(entries.map((entry) => [entry.course_id, entry]));
    for (const item of scores) {
      const entry = entriesByCourse.get(item.course_id);
      if (!entry) throw httpError(400, 'Score contains a course outside the allocation formula');
      const value = item.score === '' || item.score === null ? null : Number(item.score);
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 10)) throw httpError(400, `${entry.course_name_snapshot} score must be between 0 and 10`);
      await connection.query(`UPDATE allocation_score_entries SET score=?,updated_by=? WHERE id=?`, [value, req.user.id, entry.id]);
    }
    const finalScore = await updateFinalScore(connection, req.params.allocationId, req.user.id);
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
    if (rows[0].list_status !== 'Draft') throw httpError(409, 'Vessel allocation is locked');
    const allocation = rows[0];
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
      if (vessel && ![allocation.department, 'Both'].includes(vessel.department || 'Both')) throw httpError(400, `${slot.label} vessel is not available for this candidate department`);
      slot.typeId ||= vessel?.vessel_type_id || null;
      const type = slot.typeId ? typesById.get(slot.typeId) : null;
      if (!type || type.status !== 'Active' || ![allocation.department, 'Both'].includes(type.department)) throw httpError(400, `${slot.label} vessel type is incompatible`);
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
    const legacyTarget = ['up','down'].includes(direction) ? currentRank + (direction === 'up' ? -1 : 1) : null;
    const targetRank = Number(req.body.target_rank ?? legacyTarget);
    let movePlan;
    try { movePlan = createRankMovePlan(currentRank, targetRank, rankedRows.length); }
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
    await connection.commit(); res.json({ success: true, message: 'Ranks reset to score order' });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const finalizeRankList = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const list = await getRankList(connection, req.params.rankListId, true); ensureDraft(list);
    const [allocations] = await connection.query(
      `SELECT a.*,c.status AS cadet_status,c.workflow_phase,c.workflow_result,
              pv.status AS primary_vessel_status,pv.vessel_type_id AS primary_actual_type,pvt.department AS primary_type_department,
              sv.status AS secondary_vessel_status,sv.vessel_type_id AS secondary_actual_type,svt.department AS secondary_type_department
       FROM allocations a JOIN cadets c ON c.id=a.cadet_id
       LEFT JOIN vessels pv ON pv.id=a.vessel_id LEFT JOIN vessel_types pvt ON pvt.id=a.vessel_type_id
       LEFT JOIN vessels sv ON sv.id=a.secondary_vessel_id LEFT JOIN vessel_types svt ON svt.id=a.secondary_vessel_type_id
       WHERE a.rank_list_id=? AND a.is_active=1 FOR UPDATE`, [list.id],
    );
    if (!allocations.length) throw httpError(400, 'Add candidates before finalizing the rank list');
    for (const allocation of allocations) {
      const [incomplete] = await connection.query(`SELECT COUNT(*) AS count FROM allocation_score_entries WHERE allocation_id=? AND score IS NULL`, [allocation.id]);
      if (allocation.final_score === null || incomplete[0].count || !allocation.current_rank) throw httpError(400, 'All candidates need complete scores and ranks');
      if (!hasAllocatedVessel({
        primaryVesselId: allocation.vessel_id,
        primaryStatus: allocation.allocation_status,
        secondaryVesselId: allocation.secondary_vessel_id,
        secondaryStatus: allocation.secondary_allocation_status,
      })) throw httpError(400, 'Every candidate must have at least one Allocated Primary or Secondary vessel');
      if (allocation.allocation_status === 'Allocated' && (
        allocation.primary_vessel_status !== 'Active'
        || allocation.primary_actual_type !== allocation.vessel_type_id
        || ![list.department, 'Both'].includes(allocation.primary_type_department)
      )) throw httpError(400, 'A candidate has an incompatible or inactive Primary vessel');
      if (allocation.secondary_allocation_status === 'Allocated' && (
        allocation.secondary_vessel_status !== 'Active'
        || allocation.secondary_actual_type !== allocation.secondary_vessel_type_id
        || ![list.department, 'Both'].includes(allocation.secondary_type_department)
      )) throw httpError(400, 'A candidate has an incompatible or inactive Secondary vessel');
      await connection.query(
        `UPDATE allocations SET previous_cadet_status=COALESCE(previous_cadet_status,?),previous_workflow_phase=COALESCE(previous_workflow_phase,?),previous_workflow_result=COALESCE(previous_workflow_result,?) WHERE id=?`,
        [allocation.cadet_status, allocation.workflow_phase, allocation.workflow_result, allocation.id],
      );
      await connection.query(`UPDATE cadets SET status='CTV Assigned',workflow_phase='selected',workflow_result='ctv_assigned',workflow_updated_at=NOW() WHERE id=?`, [allocation.cadet_id]);
      await connection.query(
        `INSERT INTO onboarding (id,cadet_id,allocation_id,status) SELECT ?,?,?, 'Pending'
         WHERE NOT EXISTS (SELECT 1 FROM onboarding WHERE allocation_id=?)`, [uuidv4(), allocation.cadet_id, allocation.id, allocation.id],
      );
    }
    await connection.query(`UPDATE allocation_rank_lists SET status='Finalized',finalized_by=?,finalized_at=NOW() WHERE id=?`, [req.user.id, list.id]);
    await connection.query(`INSERT INTO allocation_rank_history (id,rank_list_id,action,remarks,changed_by) VALUES (?,?,'Finalize',?,?)`, [uuidv4(), list.id, req.body.remarks || 'Rank list finalized', req.user.id]);
    await connection.commit(); await logAction(req, 'FINALIZE_CTV_RANK_LIST', `Finalized ${list.department} list for ${list.allocation_number}`);
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
    await connection.query(`UPDATE joining_plans jp JOIN allocations a ON a.id=jp.allocation_id SET jp.status='Needs Review' WHERE a.rank_list_id=?`, [list.id]);
    await connection.query(`UPDATE allocation_rank_lists SET status='Draft',unlocked_by=?,unlocked_at=NOW(),unlock_remarks=? WHERE id=?`, [req.user.id, req.body.remarks.trim(), list.id]);
    await connection.query(`INSERT INTO allocation_rank_history (id,rank_list_id,action,remarks,changed_by) VALUES (?,?,'Unlock',?,?)`, [uuidv4(), list.id, req.body.remarks.trim(), req.user.id]);
    await connection.commit(); await logAction(req, 'UNLOCK_CTV_RANK_LIST', `Unlocked ${list.department} list for ${list.allocation_number}: ${req.body.remarks.trim()}`);
    res.json({ success: true, message: `${list.department} rank list unlocked` });
  } catch (error) { await connection.rollback(); errorResponse(res, error); }
  finally { connection.release(); }
};

const createJoiningPlan = async (req, res) => {
  try {
    const vesselRole = req.body.vessel_role || 'Primary';
    if (!['Primary','Secondary'].includes(vesselRole)) throw httpError(400, 'Vessel role must be Primary or Secondary');
    const [rows] = await db.query(
      `SELECT a.id AS allocation_id,rl.status AS list_status,
              a.allocation_status,a.secondary_allocation_status,
              pv.id AS primary_id,pv.name AS primary_name,pv.vessel_type AS primary_type_text,
              pv.location AS primary_location,pv.joining_date AS primary_joining_date,pv.total_seats AS primary_total_seats,
              pv.voyage_ref AS primary_voyage_ref,pv.reporting_port AS primary_reporting_port,
              pv.contact_person_name AS primary_contact_name,pv.contact_person_email AS primary_contact_email,
              pv.contact_person_phone AS primary_contact_phone,pv.communication_details AS primary_communication,
              pv.required_documents AS primary_documents,pvt.name AS primary_type_name,
              sv.id AS secondary_id,sv.name AS secondary_name,sv.vessel_type AS secondary_type_text,
              sv.location AS secondary_location,sv.joining_date AS secondary_joining_date,sv.total_seats AS secondary_total_seats,
              sv.voyage_ref AS secondary_voyage_ref,sv.reporting_port AS secondary_reporting_port,
              sv.contact_person_name AS secondary_contact_name,sv.contact_person_email AS secondary_contact_email,
              sv.contact_person_phone AS secondary_contact_phone,sv.communication_details AS secondary_communication,
              sv.required_documents AS secondary_documents,svt.name AS secondary_type_name
       FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       LEFT JOIN vessels pv ON pv.id=a.vessel_id LEFT JOIN vessel_types pvt ON pvt.id=pv.vessel_type_id
       LEFT JOIN vessels sv ON sv.id=a.secondary_vessel_id LEFT JOIN vessel_types svt ON svt.id=sv.vessel_type_id
       WHERE a.id=? AND a.is_active=1`, [req.params.allocationId],
    );
    const allocation = rows[0];
    if (!allocation) throw httpError(404, 'Candidate allocation not found');
    const prefix = vesselRole.toLowerCase();
    if (allocation[`${prefix}_id`] === null || allocation[vesselRole === 'Primary' ? 'allocation_status' : 'secondary_allocation_status'] !== 'Allocated') {
      throw httpError(400, `${vesselRole} vessel must be Allocated before creating its Joining Plan`);
    }
    const item = {
      allocation_id: allocation.allocation_id,
      name: allocation[`${prefix}_name`],
      type_name: allocation[`${prefix}_type_name`],
      vessel_type: allocation[`${prefix}_type_text`],
      location: allocation[`${prefix}_location`],
      joining_date: allocation[`${prefix}_joining_date`],
      total_seats: allocation[`${prefix}_total_seats`],
      voyage_ref: allocation[`${prefix}_voyage_ref`],
      reporting_port: allocation[`${prefix}_reporting_port`],
      contact_person_name: allocation[`${prefix}_contact_name`],
      contact_person_email: allocation[`${prefix}_contact_email`],
      contact_person_phone: allocation[`${prefix}_contact_phone`],
      communication_details: allocation[`${prefix}_communication`],
      required_documents: allocation[`${prefix}_documents`],
    };
    if (allocation.list_status !== 'Finalized') throw httpError(409, 'Finalize the department rank list before creating a Joining Plan');
    const id = uuidv4();
    await db.query(
      `INSERT INTO joining_plans (id,allocation_id,vessel_role,status,vessel_name,vessel_type,location,joining_date,total_seats,voyage_ref,reporting_port,contact_person_name,contact_person_email,contact_person_phone,communication_details,required_documents,created_by)
       VALUES (?,?,?, 'Draft',?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE id=id`,
      [id, item.allocation_id, vesselRole, item.name, item.type_name || item.vessel_type, item.location, item.joining_date, item.total_seats, item.voyage_ref, item.reporting_port, item.contact_person_name, item.contact_person_email, item.contact_person_phone, item.communication_details, item.required_documents ? JSON.stringify(parseJson(item.required_documents, [])) : null, req.user.id],
    );
    const [plans] = await db.query(`SELECT * FROM joining_plans WHERE allocation_id=? AND vessel_role=?`, [item.allocation_id, vesselRole]);
    res.status(201).json({ success: true, data: plans[0] });
  } catch (error) { errorResponse(res, error); }
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);

const recordCommunication = async (req, res) => {
  try {
    const { mode, informed_by, date_of_informing, confirmation_received, candidate_remarks, admin_remarks } = req.body;
    if (!['Email','Phone','WhatsApp'].includes(mode)) throw httpError(400, 'Select Email, Phone, or WhatsApp');
    const informedBy = informed_by || req.user.id;
    const [users] = await db.query(`SELECT id FROM users WHERE id=? AND status='active' AND LOWER(role) IN ('admin','superadmin')`, [informedBy]);
    if (!users[0]) throw httpError(400, 'Informed By must be an active Admin or Super Admin');
    const [rows] = await db.query(
      `SELECT jp.*,a.cadet_id,c.name_as_in_indos_cert,c.email_id,c.cadet_unique_id
       FROM joining_plans jp JOIN allocations a ON a.id=jp.allocation_id JOIN cadets c ON c.id=a.cadet_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       WHERE jp.id=? AND rl.status='Finalized'`, [req.params.joiningPlanId],
    );
    const plan = rows[0]; if (!plan) throw httpError(404, 'Finalized Joining Plan not found');
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
              <tr><th align="left">Contact Person</th><td>${escapeHtml(plan.contact_person_name || '-')} ${escapeHtml(plan.contact_person_phone || '')}</td></tr>
            </table>
            <p><strong>Required Documents:</strong> ${escapeHtml(documents.length ? documents.join(', ') : 'As advised by the administration')}</p>
            <p>${escapeHtml(plan.communication_details || '')}</p>`,
        });
        deliveryStatus = 'Sent'; messageId = result.messageId || null;
      } catch (error) { deliveryStatus = 'Failed'; failureReason = error.message; }
    }
    const communicationId = uuidv4();
    await db.query(
      `INSERT INTO allocation_communications (id,joining_plan_id,informed_by,date_of_informing,mode,confirmation_received,candidate_remarks,admin_remarks,delivery_status,email_message_id,failure_reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [communicationId, plan.id, informedBy, date_of_informing || new Date(), mode, confirmation_received ? 1 : 0, candidate_remarks || null, admin_remarks || null, deliveryStatus, messageId, failureReason],
    );
    await db.query(`UPDATE joining_plans SET status=? WHERE id=?`, [deliveryStatus === 'Failed' ? 'Needs Review' : (confirmation_received ? 'Confirmed' : 'Informed'), plan.id]);
    const responseStatus = deliveryStatus === 'Failed' ? 502 : 201;
    res.status(responseStatus).json({ success: deliveryStatus !== 'Failed', message: deliveryStatus === 'Failed' ? 'Email failed; the failed attempt was recorded' : 'Communication recorded', data: { id: communicationId, delivery_status: deliveryStatus, failure_reason: failureReason } });
  } catch (error) { errorResponse(res, error); }
};

const listJoiningPlans = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT jp.*,a.current_rank,a.allocation_status,a.secondary_allocation_status,c.cadet_unique_id,c.name_as_in_indos_cert,c.email_id,
              rl.department,ac.allocation_number,
              (SELECT mode FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id ORDER BY cm.created_at DESC LIMIT 1) AS last_mode,
              (SELECT delivery_status FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id ORDER BY cm.created_at DESC LIMIT 1) AS email_delivery_status,
              (SELECT informed_at FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id ORDER BY cm.created_at DESC LIMIT 1) AS last_informed_at,
              (SELECT confirmation_received FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id ORDER BY cm.created_at DESC LIMIT 1) AS confirmation_received,
              (SELECT admin_remarks FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id ORDER BY cm.created_at DESC LIMIT 1) AS last_admin_remarks
       FROM joining_plans jp JOIN allocations a ON a.id=jp.allocation_id JOIN cadets c ON c.id=a.cadet_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id
       WHERE (? IS NULL OR ac.id=?) ORDER BY jp.created_at DESC`, [req.query.cycle_id || null, req.query.cycle_id || null],
    );
    rows.forEach((row) => { row.required_documents = parseJson(row.required_documents, []); });
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
  listCycles, getCycle, createCycle, listEligibleCandidates, verifyDocuments, addCandidates,
  removeCandidate, updateScores, updateVesselAllocation, moveRank, resetRanks,
  finalizeRankList, unlockRankList, createJoiningPlan, recordCommunication, listJoiningPlans, listAdmins,
};
