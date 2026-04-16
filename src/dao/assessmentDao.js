const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { filterExistingColumns } = require('../services/schemaCompatibilityService');

const createOrUpdateAssessment = async (assessmentData) => {
  const {
    cadet_id,
    assessment_date,
    assessment_time,
    ces_test,
    ces_test_2,
    qa_test,
    english_test,
    essay_writing_mark,
    essay_data,
    essay_mime_type,
    essay_name,
    remarks,
    invite_remark,
    invite_document_link,
    status,
    mark_for_interview,
  } = assessmentData;

  // Calculate score logic: CES (1st attempt only) + English + Essay
  let ces_score = 0;
  const ces1 = parseFloat(ces_test) || 0;
  ces_score = ces1;

  const eng = parseFloat(english_test) || 0;
  const essay = parseFloat(essay_writing_mark) || 0;
  
  const calculated_score = ces_score + eng + essay;

  // Verify that the cadet exists
  const [cadetExists] = await db.query('SELECT id FROM cadets WHERE id = ?', [
    cadet_id,
  ]);
  if (cadetExists.length === 0) {
    throw new Error(
      'Invalid Cadet ID: This cadet does not exist in the database.',
    );
  }

  const id = uuidv4();

  // Check if assessment already exists for this cadet
  const [existing] = await db.query(
    'SELECT id FROM assessments WHERE cadet_id = ?',
    [cadet_id],
  );

  let assessmentId;
  if (existing.length > 0) {
    const updateFields = [];
    const values = [];
    const fields = await filterExistingColumns('assessments', {
      assessment_date,
      assessment_time,
      ces_test,
      ces_test_2,
      qa_test,
      english_test,
      essay_writing_mark,
      essay_data,
      essay_mime_type,
      essay_name,
      remarks,
      invite_remark,
      invite_document_link,
      status,
      mark_for_interview,
      calculated_score,
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
        `UPDATE assessments SET ${updateFields.join(', ')} WHERE cadet_id = ?`,
        values,
      );
    }
    assessmentId = existing[0].id;
  } else {
    const insertData = await filterExistingColumns('assessments', {
      id,
      cadet_id,
      assessment_date,
      assessment_time,
      ces_test,
      ces_test_2,
      qa_test,
      english_test,
      essay_writing_mark,
      essay_data,
      essay_mime_type,
      essay_name,
      remarks,
      invite_remark,
      invite_document_link,
      status,
      mark_for_interview,
      calculated_score,
    });
    const fields = Object.keys(insertData);
    const placeholders = fields.map(() => '?');
    const values = fields.map((field) => insertData[field]);

    await db.query(
      `INSERT INTO assessments (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values,
    );
    assessmentId = id;
  }
  return assessmentId;
};

const getAssessmentByCadetId = async (cadetId) => {
  // Join with cadets table to return the name for verification
  const [rows] = await db.query(
    `
    SELECT a.*, c.name_as_in_indos_cert as cadet_name 
    FROM assessments a
    JOIN cadets c ON a.cadet_id = c.id
    WHERE a.cadet_id = ?
  `,
    [cadetId],
  );
  const assessment = rows[0];

  if (assessment) {
    // Add a flag to indicate if an essay is present
    assessment.has_essay = !!assessment.essay_data;

    // Remove only the large binary data to keep JSON responses small
    // but keep metadata so the frontend knows a file exists.
    delete assessment.essay_data;
  }
  return assessment;
};

const getAssessmentEssay = async (cadetId) => {
  const [rows] = await db.query(
    'SELECT essay_data, essay_mime_type, essay_name FROM assessments WHERE cadet_id = ?',
    [cadetId],
  );
  if (rows.length === 0 || !rows[0].essay_data) return null;
  return rows[0];
};

const deleteAssessment = async (cadetId) => {
  await db.query('DELETE FROM assessments WHERE cadet_id = ?', [cadetId]);
};

module.exports = {
  createOrUpdateAssessment,
  getAssessmentByCadetId,
  getAssessmentEssay,
  deleteAssessment,
};
