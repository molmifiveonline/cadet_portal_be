const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { filterExistingColumns } = require('../services/schemaCompatibilityService');

const createOrUpdateInterview = async (interviewData) => {
  const {
    cadet_id,
    interview_date,
    interview_time,
    panel_members,
    interviewers,
    evaluation_parameters,
    evaluation_score,
    remarks,
    comments,
    invite_remark,
    invite_document_link,
    final_decision,
    interview_sheet_data,
    interview_sheet_name,
    interview_sheet_mime_type,
    handwritten_sheet_name,
    handwritten_sheet_mime_type,
    handwritten_sheet_updated_at,
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
      interviewers,
      evaluation_parameters,
      evaluation_score,
      remarks,
      comments,
      invite_remark,
      invite_document_link,
      final_decision,
      interview_sheet_data,
      interview_sheet_name,
      interview_sheet_mime_type,
      handwritten_sheet_name,
      handwritten_sheet_mime_type,
      handwritten_sheet_updated_at,
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
      interviewers,
      evaluation_parameters,
      evaluation_score,
      remarks,
      comments,
      invite_remark,
      invite_document_link,
      final_decision,
      interview_sheet_data,
      interview_sheet_name,
      interview_sheet_mime_type,
      handwritten_sheet_name,
      handwritten_sheet_mime_type,
      handwritten_sheet_updated_at,
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

const createOrUpdateHandwrittenSheet = async (
  cadetId,
  { filename, mimeType },
) => {
  const [existing] = await db.query(
    'SELECT id FROM interviews WHERE cadet_id = ?',
    [cadetId],
  );

  const values = {
    handwritten_sheet_name: filename,
    handwritten_sheet_mime_type: mimeType,
    handwritten_sheet_updated_at: new Date(),
  };

  if (existing.length > 0) {
    const fields = await filterExistingColumns('interviews', values);
    const assignments = Object.keys(fields).map((field) => `${field} = ?`);
    if (assignments.length === 0) {
      throw new Error('Handwritten interview document columns are unavailable');
    }
    await db.query(
      `UPDATE interviews SET ${assignments.join(', ')} WHERE cadet_id = ?`,
      [...Object.values(fields), cadetId],
    );
    return existing[0].id;
  }

  const insertData = await filterExistingColumns('interviews', {
    id: uuidv4(),
    cadet_id: cadetId,
    ...values,
  });
  const fields = Object.keys(insertData);
  const placeholders = fields.map(() => '?');
  await db.query(
    `INSERT INTO interviews (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
    fields.map((field) => insertData[field]),
  );
  return insertData.id;
};

const deleteHandwrittenSheet = async (cadetId) => {
  const [result] = await db.query(
    `UPDATE interviews
     SET handwritten_sheet_name = NULL,
         handwritten_sheet_mime_type = NULL,
         handwritten_sheet_updated_at = NULL
     WHERE cadet_id = ? AND handwritten_sheet_name IS NOT NULL`,
    [cadetId],
  );
  return result.affectedRows > 0;
};

const getInterviewByCadetId = async (cadetId) => {
  const [rows] = await db.query(
    'SELECT * FROM interviews WHERE cadet_id = ?',
    [cadetId],
  );
  return rows[0];
};

const createInterviewAttachments = async (
  cadetId,
  files,
  uploadedBy,
  attachmentType = 'uploaded',
) => {
  if (!files.length) return [];

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const attachments = [];

    for (const file of files) {
      const attachment = {
        id: uuidv4(),
        cadet_id: cadetId,
        attachment_type: attachmentType,
        original_name: file.originalname,
        stored_name: file.filename,
        mime_type: file.mimetype,
        file_size: file.size || 0,
        uploaded_by: uploadedBy || null,
      };
      await connection.query(
        `INSERT INTO interview_attachments (
          id, cadet_id, attachment_type, original_name, stored_name, mime_type, file_size, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          attachment.id,
          attachment.cadet_id,
          attachment.attachment_type,
          attachment.original_name,
          attachment.stored_name,
          attachment.mime_type,
          attachment.file_size,
          attachment.uploaded_by,
        ],
      );
      attachments.push(attachment);
    }

    await connection.commit();
    return attachments;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getInterviewAttachments = async (cadetId) => {
  const [rows] = await db.query(
    `SELECT
      ia.id,
      ia.cadet_id,
      ia.original_name,
      ia.mime_type,
      ia.file_size,
      ia.created_at,
      CONCAT_WS(' ', u.first_name, u.last_name) AS uploaded_by_name
    FROM interview_attachments ia
    LEFT JOIN users u ON u.id = ia.uploaded_by
    WHERE ia.cadet_id = ? AND ia.attachment_type = 'uploaded'
    ORDER BY ia.created_at DESC, ia.id DESC`,
    [cadetId],
  );
  return rows;
};

const getInterviewAttachmentById = async (cadetId, attachmentId) => {
  const [rows] = await db.query(
    `SELECT * FROM interview_attachments
     WHERE id = ? AND cadet_id = ? AND attachment_type = 'uploaded'
     LIMIT 1`,
    [attachmentId, cadetId],
  );
  return rows[0];
};

const createHandwrittenDocument = async (cadetId, file, uploadedBy) => {
  const documents = await createInterviewAttachments(
    cadetId,
    [file],
    uploadedBy,
    'handwritten',
  );
  return documents[0];
};

const getHandwrittenDocuments = async (cadetId) => {
  const [rows] = await db.query(
    `SELECT
      ia.id,
      ia.cadet_id,
      ia.original_name,
      ia.mime_type,
      ia.file_size,
      ia.created_at,
      CONCAT_WS(' ', u.first_name, u.last_name) AS uploaded_by_name
    FROM interview_attachments ia
    LEFT JOIN users u ON u.id = ia.uploaded_by
    WHERE ia.cadet_id = ? AND ia.attachment_type = 'handwritten'
    ORDER BY ia.created_at DESC, ia.id DESC`,
    [cadetId],
  );
  return rows;
};

const getHandwrittenDocumentById = async (cadetId, documentId) => {
  const [rows] = await db.query(
    `SELECT * FROM interview_attachments
     WHERE id = ? AND cadet_id = ? AND attachment_type = 'handwritten'
     LIMIT 1`,
    [documentId, cadetId],
  );
  return rows[0];
};

const deleteHandwrittenDocument = async (cadetId, documentId) => {
  const document = await getHandwrittenDocumentById(cadetId, documentId);
  if (!document) return null;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `DELETE FROM interview_attachments
       WHERE id = ? AND cadet_id = ? AND attachment_type = 'handwritten'`,
      [documentId, cadetId],
    );
    await connection.query(
      `UPDATE interviews
       SET handwritten_sheet_name = NULL,
           handwritten_sheet_mime_type = NULL,
           handwritten_sheet_updated_at = NULL
       WHERE cadet_id = ? AND handwritten_sheet_name = ?`,
      [cadetId, document.stored_name],
    );
    await connection.commit();
    return document;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const deleteInterviewAttachment = async (cadetId, attachmentId) => {
  const attachment = await getInterviewAttachmentById(cadetId, attachmentId);
  if (!attachment) return null;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      'DELETE FROM interview_attachments WHERE id = ? AND cadet_id = ?',
      [attachmentId, cadetId],
    );
    await connection.query(
      `UPDATE interviews
       SET interview_sheet_name = NULL,
           interview_sheet_data = NULL,
           interview_sheet_mime_type = NULL
       WHERE cadet_id = ? AND interview_sheet_name = ?`,
      [cadetId, attachment.stored_name],
    );
    await connection.commit();
    return attachment;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const deleteInterview = async (cadetId) => {
  await db.query('DELETE FROM interviews WHERE cadet_id = ?', [cadetId]);
};

module.exports = {
  createOrUpdateInterview,
  createOrUpdateHandwrittenSheet,
  deleteHandwrittenSheet,
  getInterviewByCadetId,
  createInterviewAttachments,
  getInterviewAttachments,
  getInterviewAttachmentById,
  deleteInterviewAttachment,
  createHandwrittenDocument,
  getHandwrittenDocuments,
  getHandwrittenDocumentById,
  deleteHandwrittenDocument,
  deleteInterview,
};
