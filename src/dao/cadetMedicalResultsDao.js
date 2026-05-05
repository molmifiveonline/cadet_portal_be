const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { filterExistingColumns, hasColumn } = require('../services/schemaCompatibilityService');

const createOrUpdateMedicalResult = async (medicalData) => {
  const {
    cadet_id,
    medical_date,      // maps to -> appointment_date
    medical_center_id,
    fit_status,        // maps to -> status
    final_decision,
    remarks,
    medical_time,      // maps to -> appointment_time
    psychometric_status,
    profiling_status,
    invite_remark,
    report_data,
    report_name,
    report_mime_type,
  } = medicalData;

  const [existing] = await db.query(
    'SELECT id FROM cadet_medical_results WHERE cadet_id = ?',
    [cadet_id],
  );

  if (existing.length > 0) {
    const updateFields = [];
    const values = [];

    // Map friendly names to actual DB column names
    const fields = await filterExistingColumns('cadet_medical_results', {
      appointment_date: medical_date,
      medical_center_id,
      status: fit_status,
      final_decision,
      remarks,
      appointment_time: medical_time,
      psychometric_status,
      profiling_status,
      invite_remark,
      report_data,
      report_name,
      report_mime_type,
    });

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updateFields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updateFields.length > 0) {
      values.push(cadet_id);
      await db.query(
        `UPDATE cadet_medical_results SET ${updateFields.join(', ')} WHERE cadet_id = ?`,
        values,
      );
    }
    return existing[0].id;
  } else {
    const id = uuidv4();
    const insertData = await filterExistingColumns('cadet_medical_results', {
      id,
      cadet_id,
      appointment_date: medical_date,
      medical_center_id,
      status: fit_status,
      final_decision,
      remarks,
      appointment_time: medical_time,
      psychometric_status,
      profiling_status,
      invite_remark,
      report_data,
      report_name,
      report_mime_type,
    });
    const fields = Object.keys(insertData);
    const placeholders = fields.map(() => '?');
    const values = fields.map((field) => insertData[field]);

    await db.query(
      `INSERT INTO cadet_medical_results (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values,
    );
    return id;
  }
};

const getMedicalResultByCadetId = async (cadetId) => {
  const hasFinalDecision = await hasColumn('cadet_medical_results', 'final_decision');
  const hasPsychometricStatus = await hasColumn('cadet_medical_results', 'psychometric_status');
  const hasProfilingStatus = await hasColumn('cadet_medical_results', 'profiling_status');
  const hasInviteRemark = await hasColumn('cadet_medical_results', 'invite_remark');

  // Alias actual column names back to the friendly names expected by the frontend
  const [rows] = await db.query(
    `SELECT id, cadet_id,
            appointment_date  AS medical_date,
            appointment_time  AS medical_time,
            status            AS fit_status,
            ${hasFinalDecision ? 'final_decision' : 'NULL AS final_decision'},
            medical_center_id,
            ${hasPsychometricStatus ? 'psychometric_status' : 'NULL AS psychometric_status'},
            ${hasProfilingStatus ? 'profiling_status' : 'NULL AS profiling_status'},
            remarks,
            ${hasInviteRemark ? 'invite_remark' : 'NULL AS invite_remark'},
            report_name,
            report_mime_type,
            created_at, updated_at
     FROM cadet_medical_results
     WHERE cadet_id = ?`,
    [cadetId],
  );
  return rows[0];
};

const deleteMedicalResult = async (cadetId) => {
  await db.query('DELETE FROM cadet_medical_results WHERE cadet_id = ?', [cadetId]);
};

module.exports = {
  createOrUpdateMedicalResult,
  getMedicalResultByCadetId,
  deleteMedicalResult,
};


