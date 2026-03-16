const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createOrUpdateMedicalResult = async (medicalData) => {
  const {
    cadet_id,
    medical_date,
    medical_center,
    fit_status,
    remarks,
  } = medicalData;

  const [existing] = await db.query(
    'SELECT id FROM cadet_medical_results WHERE cadet_id = ?',
    [cadet_id],
  );

  if (existing.length > 0) {
    const updateFields = [];
    const values = [];

    const fields = {
      medical_date,
      medical_center,
      fit_status,
      remarks,
    };

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
    const fields = ['id', 'cadet_id'];
    const placeholders = ['?', '?'];
    const values = [id, cadet_id];

    const optionalFields = {
      medical_date,
      medical_center,
      fit_status,
      remarks,
    };

    for (const [key, value] of Object.entries(optionalFields)) {
      if (value !== undefined) {
        fields.push(key);
        placeholders.push('?');
        values.push(value);
      }
    }

    await db.query(
      `INSERT INTO cadet_medical_results (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values,
    );
    return id;
  }
};

const getMedicalResultByCadetId = async (cadetId) => {
  const [rows] = await db.query(
    'SELECT * FROM cadet_medical_results WHERE cadet_id = ?',
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
