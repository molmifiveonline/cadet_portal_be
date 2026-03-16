const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createOrUpdateInterview = async (interviewData) => {
  const {
    cadet_id,
    interview_date,
    panel_members,
    evaluation_score,
    remarks,
    final_decision,
  } = interviewData;

  const [existing] = await db.query(
    'SELECT id FROM interviews WHERE cadet_id = ?',
    [cadet_id],
  );

  if (existing.length > 0) {
    const updateFields = [];
    const values = [];

    const fields = {
      interview_date,
      panel_members,
      evaluation_score,
      remarks,
      final_decision,
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
        `UPDATE interviews SET ${updateFields.join(', ')} WHERE cadet_id = ?`,
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
      interview_date,
      panel_members,
      evaluation_score,
      remarks,
      final_decision,
    };

    for (const [key, value] of Object.entries(optionalFields)) {
      if (value !== undefined) {
        fields.push(key);
        placeholders.push('?');
        values.push(value);
      }
    }

    await db.query(
      `INSERT INTO interviews (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values,
    );
    return id;
  }
};

const getInterviewByCadetId = async (cadetId) => {
  const [rows] = await db.query(
    'SELECT * FROM interviews WHERE cadet_id = ?',
    [cadetId],
  );
  return rows[0];
};

const deleteInterview = async (cadetId) => {
  await db.query('DELETE FROM interviews WHERE cadet_id = ?', [cadetId]);
};

module.exports = {
  createOrUpdateInterview,
  getInterviewByCadetId,
  deleteInterview,
};
