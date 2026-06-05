const crypto = require('crypto');
const documentDao = require('../dao/documentDao');
const cadetDao = require('../dao/cadetDao');
const instituteDao = require('../dao/instituteDao');
const activityLogDao = require('../dao/activityLogDao');
const recruitmentDriveDao = require('../dao/recruitmentDriveDao');
const { COMMUNICATION_TYPES } = require('../services/recruitmentWorkflowService');
const {
  logAndSendEmail,
  logAndSendBatchEmail,
  emailTemplates,
} = require('../services/recruitmentCommunicationService');
const { EXTERNAL_LINK_EXPIRY_HOURS, FRONTEND_URL, ROLES } = require('../config/constants');

const groupDocumentsByCadet = (rows = []) => {
  const grouped = new Map();

  rows.forEach((row) => {
    if (!grouped.has(row.cadet_id)) {
      grouped.set(row.cadet_id, {
        cadet_id: row.cadet_id,
        cadet_unique_id: row.cadet_unique_id,
        name_as_in_indos_cert: row.name_as_in_indos_cert,
        email_id: row.email_id,
        status: row.status,
        workflow_phase: row.workflow_phase,
        document_email_date: row.document_email_date,
        documents: [],
      });
    }

    if (row.id) {
      grouped.get(row.cadet_id).documents.push({
        id: row.id,
        document_name: row.document_name,
        document_type: row.document_type,
        document_mime_type: row.document_mime_type,
        original_filename: row.original_filename,
        status: row.document_status,
        admin_remarks: row.admin_remarks,
        source: row.source,
        external_upload_link: row.external_upload_link,
        external_reference: row.external_reference,
        requested_at: row.requested_at,
        request_expires_at: row.request_expires_at,
        last_reupload_requested_at: row.last_reupload_requested_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }
  });

  return Array.from(grouped.values());
};

const getInstituteId = (user = {}) => user.instituteId || user.id;

const isInstituteUser = (user = {}) => user.role === ROLES.INSTITUTE;

const ensureInstituteOwnsCadet = async (req, cadet) => {
  if (!isInstituteUser(req.user)) return true;
  return cadet?.institute_id === getInstituteId(req.user);
};

const canInstituteUploadDocument = async (cadetId) => {
  const documents = await documentDao.getCadetDocuments(cadetId);
  const hasCv = documents.some(
    (document) => String(document.document_type || '').toUpperCase() === 'CV',
  );
  const hasPendingUpload = documents.some(
    (document) =>
      document.status === 'reupload_requested' ||
      (document.status === 'pending' && !document.original_filename),
  );

  return !hasCv || hasPendingUpload;
};

const getInstituteRecipient = async (instituteId, instituteCache = new Map()) => {
  if (!instituteId) return null;

  const cacheKey = String(instituteId);
  if (!instituteCache.has(cacheKey)) {
    instituteCache.set(cacheKey, instituteDao.getInstituteById(instituteId));
  }

  const institute = await instituteCache.get(cacheKey);
  const email = instituteDao.getDefaultContactEmail(institute);
  if (!institute || !email) return null;

  return { institute, email };
};

const getCadetDisplayName = (cadet = {}) =>
  cadet.name_as_in_indos_cert || cadet.cadet_unique_id || cadet.id || 'Cadet';

const addDocumentRequestBatchItem = (batches, recipient, item) => {
  const key = `${recipient.email}|${item.institute_id}`;
  if (!batches.has(key)) {
    batches.set(key, {
      recipient,
      items: [],
    });
  }
  batches.get(key).items.push(item);
};

const getDriveDocuments = async (req, res) => {
  try {
    const { drive_id } = req.query;
    if (!drive_id) {
      return res.status(400).json({ success: false, message: 'drive_id is required' });
    }

    if (isInstituteUser(req.user)) {
      const drive = await recruitmentDriveDao.getRecruitmentDriveById(drive_id);
      if (!drive) {
        return res.status(404).json({ success: false, message: 'Recruitment drive not found' });
      }
      if (drive.institute_id !== getInstituteId(req.user)) {
        return res.status(403).json({ success: false, message: 'Access denied to this recruitment drive' });
      }
    }

    const rows = await documentDao.getDocumentsByDrive(drive_id);
    res.json({
      success: true,
      data: groupDocumentsByCadet(rows),
    });
  } catch (error) {
    console.error('Error in getDriveDocuments:', error);
    res.status(500).json({ success: false, message: 'Failed to load documents', error: error.message });
  }
};

const uploadCadetDocument = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const { document_name, document_type } = req.body;

    if (!document_name || !document_type) {
      return res.status(400).json({
        success: false,
        message: 'document_name and document_type are required',
      });
    }

    const cadet = await cadetDao.getCadetById(cadet_id);
    if (!cadet) {
      return res.status(404).json({ success: false, message: 'Cadet not found' });
    }

    if (!(await ensureInstituteOwnsCadet(req, cadet))) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this cadet data' });
    }

    if (isInstituteUser(req.user) && !(await canInstituteUploadDocument(cadet_id))) {
      return res.status(403).json({
        success: false,
        message: 'No pending document upload is available for this cadet',
      });
    }

    const id = await documentDao.createDocument({
      cadet_id,
      document_name,
      document_type,
      document_data: req.file?.buffer || null,
      document_mime_type: req.file?.mimetype || null,
      original_filename: req.file?.originalname || null,
      source: req.file ? 'portal' : 'external',
      status: 'pending',
    });

    if (req.user?.id) {
      await activityLogDao.createLog(
        req.user.id,
        'UPLOAD_CADET_DOCUMENT',
        `Uploaded ${document_type} for cadet ${cadet.name_as_in_indos_cert}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: { id },
    });
  } catch (error) {
    console.error('Error in uploadCadetDocument:', error);
    res.status(500).json({ success: false, message: 'Failed to upload document', error: error.message });
  }
};

const reviewDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_remarks } = req.body;

    const document = await documentDao.getDocumentById(id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (isInstituteUser(req.user)) {
      return res.status(403).json({ success: false, message: 'Institute users are not allowed to review documents' });
    }

    await documentDao.updateDocument(id, {
      status,
      admin_remarks,
      reviewed_by: req.user?.id || null,
      reviewed_at: new Date(),
      last_reupload_requested_at: status === 'reupload_requested' ? new Date() : document.last_reupload_requested_at,
    });

    const recipient = await getInstituteRecipient(document.institute_id);
    if (recipient) {
      const documentLink =
        document.external_upload_link ||
        `${FRONTEND_URL || ''}/drives/${document.drive_id}`;

      const allCadetDocuments = await documentDao.getDocumentsByCadetForDrive(document.cadet_id, document.drive_id);
      const requiresReupload = allCadetDocuments.some(doc => doc.status === 'reupload_requested');

      await logAndSendEmail({
        to: recipient.email,
        template: emailTemplates.documentStatusReport,
        templateData: {
          subject: `Document Status Update - MOLMI`,
          recipientName: recipient.institute.institute_name,
          cadetName: document.name_as_in_indos_cert,
          documents: allCadetDocuments,
          requiresReupload,
          onedriveLink: documentLink,
        },
        drive_id: document.drive_id,
        cadet_id: document.cadet_id,
        institute_id: document.institute_id,
        communication_type: COMMUNICATION_TYPES.DOCUMENT_REUPLOAD,
        remarks: admin_remarks,
        sent_by: req.user?.id || null,
      });
    }

    res.json({ success: true, message: 'Document reviewed successfully' });
  } catch (error) {
    console.error('Error in reviewDocument:', error);
    res.status(500).json({ success: false, message: 'Failed to review document', error: error.message });
  }
};

const downloadDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await documentDao.getDocumentById(id);

    if (!document || !document.document_data) {
      return res.status(404).json({ success: false, message: 'Document file not found' });
    }

    if (isInstituteUser(req.user) && document.institute_id !== getInstituteId(req.user)) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this document' });
    }

    res.set({
      'Content-Type': document.document_mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${document.original_filename || document.document_name}"`,
    });
    res.send(document.document_data);
  } catch (error) {
    console.error('Error in downloadDocument:', error);
    res.status(500).json({ success: false, message: 'Failed to download document', error: error.message });
  }
};

const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await documentDao.getDocumentById(id);

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (isInstituteUser(req.user)) {
      return res.status(403).json({ success: false, message: 'Institute users are not allowed to delete documents' });
    }

    await documentDao.deleteDocument(id);

    if (req.user?.id) {
      await activityLogDao.createLog(
        req.user.id,
        'DELETE_CADET_DOCUMENT',
        `Deleted ${document.document_type} for cadet ${document.name_as_in_indos_cert}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error in deleteDocument:', error);
    res.status(500).json({ success: false, message: 'Failed to delete document', error: error.message });
  }
};

const createExternalDocumentRequest = async ({ cadet, documentType = 'OTHER', link, sentBy, remarks }) => {
  const token = crypto.randomBytes(12).toString('hex');
  const expiresAt = new Date(Date.now() + EXTERNAL_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

  await documentDao.createDocument({
    cadet_id: cadet.id,
    document_name: `${documentType} Request`,
    document_type: documentType,
    status: 'pending',
    source: 'external',
    external_upload_link: link,
    request_token: token,
    request_expires_at: expiresAt,
    requested_at: new Date(),
    admin_remarks: remarks || null,
    reviewed_by: sentBy || null,
  });

  return { token, expiresAt };
};

const requestDocumentUpload = async (req, res) => {
  try {
    const { drive_id, cadet_links, remarks, document_name, document_type } = req.body;

    if (!drive_id || !cadet_links || !cadet_links.length) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (isInstituteUser(req.user)) {
      return res.status(403).json({ success: false, message: 'Institute users are not allowed to request documents' });
    }

    const drive = await recruitmentDriveDao.getRecruitmentDriveById(drive_id);
    if (!drive) {
      return res.status(404).json({ success: false, message: 'Recruitment drive not found' });
    }

    let successCount = 0;
    const instituteCache = new Map();
    const emailBatches = new Map();

    for (const { cadet_id: cadetId, onedrive_link, remark } of cadet_links) {
      if (!cadetId || !onedrive_link) continue;

      const cadet = await cadetDao.getCadetById(cadetId);
      if (!cadet || cadet.drive_id !== drive_id) continue;
      const recipient = await getInstituteRecipient(cadet.institute_id, instituteCache);

      // Create document record with cadet-specific OneDrive link
      await documentDao.createDocument({
        cadet_id: cadetId,
        document_name: document_name || 'Required Documents',
        document_type: document_type || 'OTHER',
        status: 'pending',
        source: 'onedrive',
        external_upload_link: onedrive_link,
        requested_at: new Date(),
        admin_remarks: remark || remarks || null,
        reviewed_by: req.user?.id || null,
      });

      if (recipient) {
        addDocumentRequestBatchItem(emailBatches, recipient, {
          drive_id,
          cadetId,
          cadetName: getCadetDisplayName(cadet),
          cadetUniqueId: cadet.cadet_unique_id,
          institute_id: cadet.institute_id,
          documentLink: onedrive_link,
          remarks: remark || remarks,
          documentName: document_name || 'Required Documents',
          documentType: document_type || 'OTHER',
        });
      }
    }

    for (const batch of emailBatches.values()) {
      try {
        const result = await logAndSendBatchEmail({
          to: batch.recipient.email,
          template: emailTemplates.documentUploadRequestBatch,
          templateData: {
            subject: 'Action Required: Document Upload - MOLMI',
            recipientName: batch.recipient.institute.institute_name,
            cadets: batch.items,
          },
          communications: batch.items.map((item) => ({
            drive_id: item.drive_id,
            cadet_id: item.cadetId,
            institute_id: item.institute_id,
            communication_type: COMMUNICATION_TYPES.DOCUMENT_REQUEST,
            remarks: item.remarks,
            sent_by: req.user?.id || null,
            payload_json: {
              subject: 'Action Required: Document Upload - MOLMI',
              ...item,
            },
          })),
        });
        successCount += result.sentCount;
      } catch (emailError) {
        console.error(
          `Failed to send document request batch email to institute ${batch.items[0]?.institute_id}:`,
          emailError,
        );
      }
    }

    res.json({ success: true, message: `Document upload requested for ${successCount} cadet(s)` });
  } catch (error) {
    console.error('Error in requestDocumentUpload:', error);
    res.status(500).json({ success: false, message: 'Failed to request documents', error: error.message });
  }
};

module.exports = {
  getDriveDocuments,
  uploadCadetDocument,
  reviewDocument,
  downloadDocument,
  deleteDocument,
  createExternalDocumentRequest,
  requestDocumentUpload,
};
