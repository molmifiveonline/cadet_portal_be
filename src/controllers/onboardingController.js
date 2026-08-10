const db = require('../config/database');
const activityLogDao = require('../dao/activityLogDao');

const CHECKS = [
  'passport_verified',
  'medical_cert_verified',
  'bank_details_verified',
  'agreement_signed',
  'final_clearance',
];

const sendError = (res, error) => {
  console.error('Onboarding Error:', error);
  res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Onboarding operation failed' });
};

const listOnboarding = async (req, res) => {
  try {
    const params = [];
    let where = `WHERE c.status IN ('CTV Assigned','Onboarded')`;
    if (req.query.status) { where += ' AND o.status=?'; params.push(req.query.status); }
    if (req.query.search) { where += ' AND (c.name_as_in_indos_cert LIKE ? OR c.cadet_unique_id LIKE ?)'; params.push(`%${req.query.search}%`, `%${req.query.search}%`); }
    const [rows] = await db.query(
      `SELECT o.*,c.cadet_unique_id,c.name_as_in_indos_cert,c.email_id,c.course,i.institute_name,
              ac.allocation_number,rl.department,v.name AS vessel_name,v.joining_date,v.reporting_port
       FROM onboarding o JOIN cadets c ON c.id=o.cadet_id
       JOIN allocations a ON a.id=o.allocation_id JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
       JOIN allocation_cycles ac ON ac.id=rl.cycle_id LEFT JOIN institutes i ON i.id=c.institute_id
       LEFT JOIN vessels v ON v.id=a.vessel_id ${where}
       ORDER BY o.status='Pending' DESC,v.joining_date,c.name_as_in_indos_cert`, params,
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
      `SELECT o.*,c.name_as_in_indos_cert FROM onboarding o JOIN cadets c ON c.id=o.cadet_id WHERE o.id=? FOR UPDATE`, [req.params.id],
    );
    if (!rows[0]) throw Object.assign(new Error('Onboarding record not found'), { status: 404 });
    if (rows[0].status === 'Onboarded') throw Object.assign(new Error('Completed onboarding records are locked'), { status: 409 });
    const next = {};
    CHECKS.forEach((key) => { next[key] = req.body[key] === undefined ? Number(rows[0][key] || 0) : (req.body[key] ? 1 : 0); });
    const complete = CHECKS.every((key) => next[key] === 1);
    await connection.query(
      `UPDATE onboarding SET passport_verified=?,medical_cert_verified=?,bank_details_verified=?,agreement_signed=?,final_clearance=?,status=?,updated_by=?,completed_by=?,completed_at=? WHERE id=?`,
      [next.passport_verified,next.medical_cert_verified,next.bank_details_verified,next.agreement_signed,next.final_clearance,complete ? 'Onboarded' : 'Pending',req.user.id,complete ? req.user.id : null,complete ? new Date() : null,rows[0].id],
    );
    if (complete) await connection.query(`UPDATE cadets SET status='Onboarded',workflow_phase='selected',workflow_result='onboarded',workflow_updated_at=NOW() WHERE id=?`, [rows[0].cadet_id]);
    await connection.commit();
    await activityLogDao.createLog(req.user.id, complete ? 'COMPLETE_CADET_ONBOARDING' : 'UPDATE_CADET_ONBOARDING', `${complete ? 'Completed' : 'Updated'} onboarding for ${rows[0].name_as_in_indos_cert}`, req.ip || req.connection?.remoteAddress);
    res.json({ success: true, data: { status: complete ? 'Onboarded' : 'Pending' } });
  } catch (error) { await connection.rollback(); sendError(res, error); }
  finally { connection.release(); }
};

module.exports = { listOnboarding, updateChecklist };
