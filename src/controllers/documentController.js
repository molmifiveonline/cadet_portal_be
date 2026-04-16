const crypto = require('crypto');
const documentDao = require('../dao/documentDao');
const cadetDao = require('../dao/cadetDao');
const activityLogDao = require('../dao/activityLogDao');
const { COMMUNICATION_TYPES } = require('../services/recruitmentWorkflowService');
const { logAndSendEmail, emailTemplates } = require('../services/recruitmentCommunicationService');
const { EXTERNAL_LINK_EXPIRY_HOURS } = require('../config/constants');

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

const getDriveDocuments = async (req, res) => {
  try {
    const { drive_id } = req.query;
    if (!drive_id) {
      return res.status(400).json({ success: false, message: 'drive_id is required' });
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

    await documentDao.updateDocument(id, {
      status,
      admin_remarks,
      reviewed_by: req.user?.id || null,
      reviewed_at: new Date(),
      last_reupload_requested_at: status === 'reupload_requested' ? new Date() : document.last_reupload_requested_at,
    });

    if (status === 'reupload_requested' && document.email_id) {
      const documentLink =
        document.external_upload_link ||
        `${process.env.FRONTEND_URL || ''}/drives/${document.drive_id}`;

      await logAndSendEmail({
        to: document.email_id,
        template: emailTemplates.stageInvite,
        templateData: {
          subject: `Re-upload requested for ${document.document_name}`,
          recipientName: document.name_as_in_indos_cert,
          message: `Please re-upload the document "${document.document_name}" requested by the MOLMI team.`,
          documentLink,
          remarks: admin_remarks,
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

module.exports = {
  getDriveDocuments,
  uploadCadetDocument,
  reviewDocument,
  downloadDocument,
  deleteDocument,
  createExternalDocumentRequest,
};
