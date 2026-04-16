const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { filterExistingColumns } = require('../services/schemaCompatibilityService');

const createOrUpdateInterview = async (interviewData) => {
  const {
    cadet_id,
    interview_date,
    interview_time,
    panel_members,
    evaluation_score,
    remarks,
    comments,
    invite_remark,
    invite_document_link,
    final_decision,
    interview_sheet_data,
    interview_sheet_name,
    interview_sheet_mime_type,
    total_score,
  } = interviewData;

  const [existing] = await db.query(
    'SELECT id FROM interviews WHERE cadet_id = ?',
    [cadet_id],
  );

  let interviewId;
  if (existing.length > 0) {
    const updateFields = [];
    const values = [];

    const fields = await filterExistingColumns('interviews', {
      interview_date,
      interview_time,
      panel_members,
      evaluation_score,
      remarks,
      comments,
      invite_remark,
      invite_document_link,
      final_decision,
      interview_sheet_data,
      interview_sheet_name,
      interview_sheet_mime_type,
      total_score,
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
        `UPDATE interviews SET ${updateFields.join(', ')} WHERE cadet_id = ?`,
        values,
      );
    }
    interviewId = existing[0].id;
  } else {
    const id = uuidv4();
    const insertData = await filterExistingColumns('interviews', {
      id,
      cadet_id,
      interview_date,
      interview_time,
      panel_members,
      evaluation_score,
      remarks,
      comments,
      invite_remark,
      invite_document_link,
      final_decision,
      interview_sheet_data,
      interview_sheet_name,
      interview_sheet_mime_type,
      total_score,
    });
    const fields = Object.keys(insertData);
    const placeholders = fields.map(() => '?');
    const values = fields.map((field) => insertData[field]);

    await db.query(
      `INSERT INTO interviews (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values,
    );
    interviewId = id;
  }
  return interviewId;
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
