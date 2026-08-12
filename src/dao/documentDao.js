const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const {
  filterExistingColumns,
  hasColumn,
} = require('../services/schemaCompatibilityService');

const createDocument = async (documentData) => {
  const id = uuidv4();
  const {
    cadet_id,
    document_name,
    document_type,
    document_data = null,
    document_mime_type = null,
    original_filename = null,
    status = 'pending',
    admin_remarks = null,
    reviewed_by = null,
    reviewed_at = null,
    source = 'portal',
    external_upload_link = null,
    external_reference = null,
    request_token = null,
    request_expires_at = null,
    requested_at = null,
    last_reupload_requested_at = null,
  } = documentData;

  const insertData = await filterExistingColumns('cadet_documents', {
    id,
    cadet_id,
    document_name,
    document_type,
    document_data,
    document_mime_type,
    original_filename,
    status,
    admin_remarks,
    reviewed_by,
    reviewed_at,
    source,
    external_upload_link,
    external_reference,
    request_token,
    request_expires_at,
    requested_at,
    last_reupload_requested_at,
  });
  const fields = Object.keys(insertData);
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map((field) => insertData[field]);

  await db.query(
    `INSERT INTO cadet_documents (${fields.join(', ')}) VALUES (${placeholders})`,
    values,
  );

  // A new document changes the reviewed set, so any previous candidate-level
  // approval must be completed again from the Recruitment Drive Documents tab.
  await db.query(
    `UPDATE document_verifications
     SET status = 'Revoked', remarks = 'A new document was added and requires review',
         verified_at = NULL
     WHERE cadet_id = ? AND status = 'Verified'`,
    [cadet_id],
  );

  return id;
};

const getDocumentById = async (id) => {
  const [rows] = await db.query(
    `SELECT cd.*, c.name_as_in_indos_cert, c.email_id, c.cadet_unique_id, c.drive_id, c.institute_id
     FROM cadet_documents cd
     JOIN cadets c ON c.id = cd.cadet_id
     WHERE cd.id = ?`,
    [id],
  );
  return rows[0] || null;
};

const getCadetDocuments = async (cadetId) => {
  const [rows] = await db.query(
    `SELECT *
     FROM cadet_documents
     WHERE cadet_id = ?
     ORDER BY created_at DESC`,
    [cadetId],
  );
  return rows;
};

const getDocumentsByDrive = async (driveId) => {
  const hasWorkflowPhase = await hasColumn('cadets', 'workflow_phase');
  const hasAdminRemarks = await hasColumn('cadet_documents', 'admin_remarks');
  const hasSource = await hasColumn('cadet_documents', 'source');
  const hasExternalUploadLink = await hasColumn('cadet_documents', 'external_upload_link');
  const hasExternalReference = await hasColumn('cadet_documents', 'external_reference');
  const hasRequestedAt = await hasColumn('cadet_documents', 'requested_at');
  const hasRequestExpiresAt = await hasColumn('cadet_documents', 'request_expires_at');
  const hasLastReuploadRequestedAt = await hasColumn(
    'cadet_documents',
    'last_reupload_requested_at',
  );
  const { hasTable } = require('../services/schemaCompatibilityService');
  const hasRecruitmentCommunications = await hasTable('recruitment_communications');

  const phaseCondition = hasWorkflowPhase
    ? "c.workflow_phase = 'selected' OR (c.workflow_phase IS NULL AND c.status IN ('Selected', 'CTV Assigned', 'Onboarded'))"
    : "c.status IN ('Selected', 'CTV Assigned', 'Onboarded')";

  const [rows] = await db.query(
    `SELECT
      c.id AS cadet_id,
      c.cadet_unique_id,
      c.name_as_in_indos_cert,
      c.email_id,
      c.status,
      ${hasWorkflowPhase ? 'c.workflow_phase' : 'NULL AS workflow_phase'},
      cd.id,
      cd.document_name,
      cd.document_type,
      cd.document_mime_type,
      cd.original_filename,
      cd.status AS document_status,
      ${hasAdminRemarks ? 'cd.admin_remarks' : 'NULL AS admin_remarks'},
      ${hasSource ? 'cd.source' : "'portal' AS source"},
      ${hasExternalUploadLink ? 'cd.external_upload_link' : 'NULL AS external_upload_link'},
      ${hasExternalReference ? 'cd.external_reference' : 'NULL AS external_reference'},
      ${hasRequestedAt ? 'cd.requested_at' : 'NULL AS requested_at'},
      ${hasRequestExpiresAt ? 'cd.request_expires_at' : 'NULL AS request_expires_at'},
      ${hasLastReuploadRequestedAt ? 'cd.last_reupload_requested_at' : 'NULL AS last_reupload_requested_at'},
      ${hasRecruitmentCommunications ? "(SELECT MAX(sent_at) FROM recruitment_communications rc WHERE rc.cadet_id = c.id AND rc.communication_type = 'document_request' AND rc.send_status = 'sent')" : 'NULL'} AS document_email_date,
      dv.status AS document_verification_status,
      dv.remarks AS document_verification_remarks,
      dv.verified_at AS document_verified_at,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', verifier.first_name, verifier.last_name)), ''), verifier.email) AS document_verified_by,
      cd.created_at,
      cd.updated_at
     FROM cadets c
     LEFT JOIN cadet_documents cd ON cd.cadet_id = c.id
     LEFT JOIN document_verifications dv ON dv.cadet_id = c.id
     LEFT JOIN users verifier ON verifier.id = dv.verified_by
     WHERE c.drive_id = ?
       AND (${phaseCondition})
     ORDER BY c.created_at DESC, cd.created_at DESC`,
    [driveId],
  );

  return rows;
};

const updateDocument = async (id, fields) => {
  const filteredFields = await filterExistingColumns('cadet_documents', fields);
  const updateFields = [];
  const values = [];

  Object.entries(filteredFields).forEach(([key, value]) => {
    if (value !== undefined) {
      updateFields.push(`${key} = ?`);
      values.push(value);
    }
  });

  if (!updateFields.length) return false;

  values.push(id);
  const [result] = await db.query(
    `UPDATE cadet_documents SET ${updateFields.join(', ')} WHERE id = ?`,
    values,
  );

  return result.affectedRows > 0;
};

const deleteDocument = async (id) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [documents] = await connection.query(
      'SELECT cadet_id FROM cadet_documents WHERE id = ? FOR UPDATE',
      [id],
    );
    if (!documents[0]) {
      await connection.rollback();
      return false;
    }
    const [result] = await connection.query('DELETE FROM cadet_documents WHERE id = ?', [id]);
    await connection.query(
      `UPDATE document_verifications
       SET status = 'Revoked', remarks = 'The approved document set was changed',
           verified_at = NULL
       WHERE cadet_id = ? AND status = 'Verified'`,
      [documents[0].cadet_id],
    );
    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const setCandidateDocumentVerification = async ({ cadetId, status, remarks, userId }) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [cadets] = await connection.query(
      `SELECT id, name_as_in_indos_cert, workflow_phase, status
       FROM cadets WHERE id = ? FOR UPDATE`,
      [cadetId],
    );
    const cadet = cadets[0];
    if (!cadet) throw Object.assign(new Error('Candidate not found'), { status: 404 });
    if (!(cadet.workflow_phase === 'selected' || ['Selected', 'Medical Completed', 'CTV Assigned'].includes(cadet.status))) {
      throw Object.assign(new Error('Only selected/document-stage candidates can be approved'), { status: 400 });
    }

    const [summaryRows] = await connection.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted
       FROM cadet_documents WHERE cadet_id = ?`,
      [cadetId],
    );
    const total = Number(summaryRows[0]?.total || 0);
    const accepted = Number(summaryRows[0]?.accepted || 0);
    if (status === 'Verified' && (!total || accepted !== total)) {
      throw Object.assign(
        new Error('Accept every candidate document before approving for CTV Allocation'),
        { status: 400 },
      );
    }

    await connection.query(
      `INSERT INTO document_verifications
         (id, cadet_id, status, remarks, verified_by, verified_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), remarks = VALUES(remarks),
         verified_by = VALUES(verified_by), verified_at = VALUES(verified_at)`,
      [uuidv4(), cadetId, status, remarks || null, userId, status === 'Verified' ? new Date() : null],
    );
    await connection.commit();
    return { cadet, total, accepted };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const revokeCandidateDocumentVerification = async (cadetId, remarks) => {
  await db.query(
    `UPDATE document_verifications
     SET status = 'Revoked', remarks = ?, verified_at = NULL
     WHERE cadet_id = ? AND status = 'Verified'`,
    [remarks, cadetId],
  );
};

const getDocumentsByCadetForDrive = async (cadetId, driveId) => {
  const [rows] = await db.query(
    `SELECT cd.* 
     FROM cadet_documents cd
     JOIN cadets c ON c.id = cd.cadet_id
     WHERE cd.cadet_id = ? AND c.drive_id = ?
     ORDER BY cd.created_at DESC`,
    [cadetId, driveId]
  );
  return rows;
};

module.exports = {
  createDocument,
  getDocumentById,
  getCadetDocuments,
  getDocumentsByDrive,
  updateDocument,
  deleteDocument,
  getDocumentsByCadetForDrive,
  setCandidateDocumentVerification,
  revokeCandidateDocumentVerification,
};
