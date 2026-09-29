const db = require('../config/database');
const activityLogDao = require('../dao/activityLogDao');
const { CHECKS, buildChecklistUpdate } = require('../services/onboardingRules');

const sendError = (res, error) => {
  console.error('Onboarding Error:', error);
  res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Onboarding operation failed' });
};

const listOnboarding = async (req, res) => {
  try {
    const params = [];
    let where = `WHERE (
      (o.status='Pending' AND c.status='CTV Assigned')
      OR (o.status='Onboarded' AND c.status='Onboarded')
    )`;
    if (req.query.status) {
      if (!['Pending', 'Onboarded'].includes(req.query.status)) {
        throw Object.assign(new Error('Status must be Pending or Onboarded'), { status: 400 });
      }
      where += ' AND o.status=?';
      params.push(req.query.status);
    }
    if (req.query.search) {
      const term = `%${req.query.search}%`;
      where += ` AND (
        c.name_as_in_indos_cert LIKE ? OR c.cadet_unique_id LIKE ?
        OR ac.allocation_number LIKE ? OR v.name LIKE ? OR sv.name LIKE ?
      )`;
      params.push(term, term, term, term, term);
    }
    const [rows] = await db.query(
      `SELECT o.*,c.cadet_unique_id,c.name_as_in_indos_cert,c.email_id,c.course,i.institute_name,
              ac.allocation_number,rl.department,
              a.current_rank,a.allocation_status,a.secondary_allocation_status,
              v.name AS primary_vessel_name,v.joining_date AS primary_joining_date,
              v.reporting_port AS primary_reporting_port,pvt.name AS primary_vessel_type,
              sv.name AS secondary_vessel_name,sv.joining_date AS secondary_joining_date,
              sv.reporting_port AS secondary_reporting_port,svt.name AS secondary_vessel_type,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ',updated_user.first_name,updated_user.last_name)),''),updated_user.email) AS updated_by_name,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ',completed_user.first_name,completed_user.last_name)),''),completed_user.email) AS completed_by_name
       FROM onboarding o JOIN cadets c ON c.id=o.cadet_id
       JOIN allocations a ON a.id=o.allocation_id JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       JOIN allocation_cycles ac ON ac.id=rl.cycle_id LEFT JOIN institutes i ON i.id=c.institute_id
       LEFT JOIN vessels v ON v.id=a.vessel_id
       LEFT JOIN vessel_types pvt ON pvt.id=a.vessel_type_id
       LEFT JOIN vessels sv ON sv.id=a.secondary_vessel_id
       LEFT JOIN vessel_types svt ON svt.id=a.secondary_vessel_type_id
       LEFT JOIN users updated_user ON updated_user.id=o.updated_by
       LEFT JOIN users completed_user ON completed_user.id=o.completed_by
       ${where}
       ORDER BY o.status='Pending' DESC,COALESCE(v.joining_date,sv.joining_date),c.name_as_in_indos_cert`, params,
    );
    rows.forEach((row) => {
      row.completed_checks = CHECKS.reduce((total, key) => total + Number(row[key] || 0), 0);
      row.total_checks = CHECKS.length;
    });
    res.json({ success: true, data: rows });
  } catch (error) { sendError(res, error); }
};

const updateChecklist = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT o.*,c.name_as_in_indos_cert,c.cadet_unique_id,c.status AS cadet_status,rl.status AS rank_list_status,
              rl.department,ac.allocation_number
       FROM onboarding o
       JOIN cadets c ON c.id=o.cadet_id
       JOIN allocations a ON a.id=o.allocation_id
       JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       JOIN allocation_cycles ac ON ac.id=rl.cycle_id
       WHERE o.id=? FOR UPDATE`, [req.params.id],
    );
    if (!rows[0]) throw Object.assign(new Error('Onboarding record not found'), { status: 404 });
    if (rows[0].status === 'Onboarded') throw Object.assign(new Error('Completed onboarding records are locked'), { status: 409 });
    if (rows[0].cadet_status !== 'CTV Assigned' || rows[0].rank_list_status !== 'Finalized') {
      throw Object.assign(new Error('Only CTV Assigned candidates from a finalized rank list can be onboarded'), { status: 409 });
    }
    let checklist;
    try {
      checklist = buildChecklistUpdate(rows[0], req.body);
    } catch (error) {
      throw Object.assign(error, { status: 400 });
    }
    const { next, complete, completedChecks, totalChecks } = checklist;
    const completedAt = complete ? new Date() : null;
    await connection.query(
      `UPDATE onboarding SET passport_verified=?,medical_cert_verified=?,bank_details_verified=?,agreement_signed=?,final_clearance=?,status=?,updated_by=?,completed_by=?,completed_at=? WHERE id=?`,
      [next.passport_verified,next.medical_cert_verified,next.bank_details_verified,next.agreement_signed,next.final_clearance,complete ? 'Onboarded' : 'Pending',req.user.id,complete ? req.user.id : null,completedAt,rows[0].id],
    );
    if (complete) await connection.query(`UPDATE cadets SET status='Onboarded',workflow_phase='selected',workflow_result='onboarded',workflow_updated_at=NOW() WHERE id=?`, [rows[0].cadet_id]);
    const checklistChanges = Object.entries(next)
      .filter(([field, value]) => Boolean(Number(rows[0][field])) !== Boolean(value))
      .map(([field, value]) => `${field.replace(/_/g, ' ')}: ${value ? 'Yes' : 'No'}`);
    await activityLogDao.createLog(req.user.id, complete ? 'COMPLETE_CADET_ONBOARDING' : 'UPDATE_CADET_ONBOARDING',
      `${complete ? 'Completed' : 'Updated'} onboarding for ${rows[0].name_as_in_indos_cert} (${rows[0].cadet_unique_id}) in ${rows[0].department} allocation ${rows[0].allocation_number}; ${checklistChanges.join('; ') || 'No checklist changes'}`,
      req.ip || req.connection?.remoteAddress, connection);
    await connection.commit();
    res.json({
      success: true,
      data: {
        ...next,
        status: complete ? 'Onboarded' : 'Pending',
        completed_checks: completedChecks,
        total_checks: totalChecks,
        completed_at: completedAt,
      },
    });
  } catch (error) { await connection.rollback(); sendError(res, error); }
  finally { connection.release(); }
};

module.exports = { listOnboarding, updateChecklist };
