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
      cd.created_at,
      cd.updated_at
     FROM cadets c
     LEFT JOIN cadet_documents cd ON cd.cadet_id = c.id
     WHERE c.drive_id = ?
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
  const [result] = await db.query('DELETE FROM cadet_documents WHERE id = ?', [id]);
  return result.affectedRows > 0;
};

module.exports = {
  createDocument,
  getDocumentById,
  getCadetDocuments,
  getDocumentsByDrive,
  updateDocument,
  deleteDocument,
};
