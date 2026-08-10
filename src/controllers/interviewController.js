const interviewDao = require('../dao/interviewDao');
const activityLogDao = require('../dao/activityLogDao');
const cadetDao = require('../dao/cadetDao');
const fs = require('fs');
const path = require('path');
const {
  WORKFLOW_PHASES,
  DISPLAY_STATUS,
  buildWorkflowUpdate,
} = require('../services/recruitmentWorkflowService');

const uploadsDirectory = path.resolve(__dirname, '../../uploads');

const getStoredFilePath = (filename) => {
  if (!filename || path.basename(filename) !== filename) {
    return null;
  }
  return path.join(uploadsDirectory, filename);
};

const removeStoredFile = async (filename) => {
  const filePath = getStoredFilePath(filename);
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Failed to remove interview file ${filename}:`, error);
    }
  }
};

const sendStoredFile = async ({
  res,
  filename,
  mimeType,
  fallbackData,
  fallbackName,
}) => {
  const filePath = getStoredFilePath(filename);
  if (filePath) {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      res.set('Content-Type', mimeType || 'application/octet-stream');
      res.set(
        'Content-Disposition',
        `inline; filename="${path.basename(fallbackName || filename).replace(/["\r\n]/g, '_')}"`,
      );
      return res.sendFile(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  if (fallbackData) {
    res.set('Content-Type', mimeType || 'application/octet-stream');
    res.set(
      'Content-Disposition',
      `inline; filename="${path.basename(fallbackName || filename || 'interview_sheet').replace(/["\r\n]/g, '_')}"`,
    );
    return res.send(fallbackData);
  }

  return res.status(404).json({
    success: false,
    message: 'Interview document not found',
  });
};

const saveInterview = async (req, res) => {
  let uploadedFilePersisted = false;
  try {
    const { cadet_id } = req.params;
    const {
      interview_date,
      interview_time,
      panel_members,
      interviewers,
      evaluation_parameters,
      evaluation_score,
      remarks,
      comments,
      final_decision,
      total_score,
    } = req.body;
    const existingAttachments = req.file
      ? await interviewDao.getInterviewAttachments(cadet_id)
      : null;

    if (req.file && existingAttachments.length > 0) {
      await removeStoredFile(req.file.filename);
      return res.status(409).json({
        success: false,
        message:
          'Interview sheets are already uploaded. Delete all existing sheets before uploading again.',
      });
    }

    const interviewData = {
      cadet_id,
      interview_date,
      interview_time,
      panel_members,
      interviewers: typeof interviewers === 'string' ? interviewers : JSON.stringify(interviewers),
      evaluation_parameters: typeof evaluation_parameters === 'string' ? evaluation_parameters : JSON.stringify(evaluation_parameters),
      evaluation_score,
      remarks,
      comments,
      final_decision,
      total_score,
    };

    const id = await interviewDao.createOrUpdateInterview(interviewData);
    if (req.file) {
      await interviewDao.createInterviewAttachments(
        cadet_id,
        [req.file],
        req.user?.id,
      );
      uploadedFilePersisted = true;
    }
    const cadet = await cadetDao.getCadetById(cadet_id);
    const cadetDisplayName =
      cadet?.name_as_in_indos_cert || cadet?.cadet_unique_id || cadet_id;

    // Workflow: selected cadets move to medical, waitlisted stays in interview, rejected becomes terminal
    const normalizedDecision = String(final_decision || '').toLowerCase();
    if (normalizedDecision === 'selected') {
      await cadetDao.updateCadet(
        cadet_id,
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.MEDICAL,
          result: 'queued',
          status: DISPLAY_STATUS.SELECTED,
        }),
      );
    } else if (normalizedDecision === 'rejected') {
      await cadetDao.updateCadet(
        cadet_id,
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.REJECTED,
          result: 'failed',
          rejectionStage: WORKFLOW_PHASES.INTERVIEW,
          status: DISPLAY_STATUS.REJECTED,
        }),
      );
    } else {
      await cadetDao.updateCadet(
        cadet_id,
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.INTERVIEW,
          result: normalizedDecision || 'waitlisted',
          status: DISPLAY_STATUS.INTERVIEWED,
        }),
      );
    }

    await activityLogDao.createLog(
      req.user.id,
      'Interview Saved',
      `Interview for cadet ${cadetDisplayName} has been saved.`,
      req.ip || req.connection.remoteAddress
    );

    res.status(200).json({
      success: true,
      message: 'Interview saved successfully',
      data: { id },
    });
  } catch (error) {
    if (req.file && !uploadedFilePersisted) {
      await removeStoredFile(req.file.filename);
    }
    console.error('Error in saveInterview:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const saveHandwrittenSheet = async (req, res) => {
  let uploadedFilePersisted = false;
  try {
    const { cadet_id } = req.params;
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A handwritten interview PDF is required',
      });
    }

    const cadet = await cadetDao.getCadetById(cadet_id);
    if (!cadet) {
      await removeStoredFile(req.file.filename);
      return res.status(404).json({
        success: false,
        message: 'Cadet not found',
      });
    }

    const savedDocument = await interviewDao.createHandwrittenDocument(
      cadet_id,
      req.file,
      req.user?.id,
    );
    uploadedFilePersisted = true;

    try {
      await activityLogDao.createLog(
        req.user.id,
        'Handwritten Interview Notes Saved',
        `Handwritten interview notes for cadet ${
          cadet.name_as_in_indos_cert || cadet.cadet_unique_id || cadet_id
        } have been saved.`,
        req.ip || req.connection.remoteAddress,
      );
    } catch (logError) {
      console.error('Failed to log handwritten interview save:', logError);
    }

    const documents = await interviewDao.getHandwrittenDocuments(cadet_id);
    const responseDocument =
      documents.find((document) => document.id === savedDocument.id) ||
      savedDocument;
    return res.status(201).json({
      success: true,
      message: 'Handwritten interview notes saved successfully',
      data: responseDocument,
    });
  } catch (error) {
    if (req.file && !uploadedFilePersisted) {
      await removeStoredFile(req.file.filename);
    }
    console.error('Error in saveHandwrittenSheet:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save handwritten interview notes',
      error: error.message,
    });
  }
};

const deleteHandwrittenSheet = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const interview = await interviewDao.getInterviewByCadetId(cadet_id);
    if (!interview?.handwritten_sheet_name) {
      return res.status(404).json({
        success: false,
        message: 'Handwritten interview notes not found',
      });
    }

    const deleted = await interviewDao.deleteHandwrittenSheet(cadet_id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Handwritten interview notes not found',
      });
    }

    await removeStoredFile(interview.handwritten_sheet_name);

    try {
      await activityLogDao.createLog(
        req.user.id,
        'Handwritten Interview Notes Deleted',
        `Deleted handwritten interview notes for cadet ${cadet_id}.`,
        req.ip || req.connection.remoteAddress,
      );
    } catch (logError) {
      console.error('Failed to log handwritten interview deletion:', logError);
    }

    return res.status(200).json({
      success: true,
      message: 'Handwritten interview notes deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting handwritten interview notes:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete handwritten interview notes',
      error: error.message,
    });
  }
};

const getHandwrittenDocuments = async (req, res) => {
  try {
    const documents = await interviewDao.getHandwrittenDocuments(
      req.params.cadet_id,
    );
    return res.status(200).json({ success: true, data: documents });
  } catch (error) {
    console.error('Error loading handwritten interview notes:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load handwritten interview notes',
      error: error.message,
    });
  }
};

const getHandwrittenDocument = async (req, res) => {
  try {
    const document = await interviewDao.getHandwrittenDocumentById(
      req.params.cadet_id,
      req.params.document_id,
    );
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Handwritten interview notes not found',
      });
    }

    return sendStoredFile({
      res,
      filename: document.stored_name,
      mimeType: document.mime_type || 'application/pdf',
      fallbackName: document.original_name,
    });
  } catch (error) {
    console.error('Error viewing handwritten interview notes:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load handwritten interview notes',
      error: error.message,
    });
  }
};

const deleteHandwrittenDocument = async (req, res) => {
  try {
    const document = await interviewDao.deleteHandwrittenDocument(
      req.params.cadet_id,
      req.params.document_id,
    );
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Handwritten interview notes not found',
      });
    }

    await removeStoredFile(document.stored_name);

    try {
      await activityLogDao.createLog(
        req.user.id,
        'Handwritten Interview Notes Deleted',
        `Deleted handwritten interview notes ${document.original_name} for cadet ${req.params.cadet_id}.`,
        req.ip || req.connection.remoteAddress,
      );
    } catch (logError) {
      console.error('Failed to log handwritten interview deletion:', logError);
    }

    return res.status(200).json({
      success: true,
      message: 'Handwritten interview notes deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting handwritten interview notes:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete handwritten interview notes',
      error: error.message,
    });
  }
};

const uploadInterviewAttachments = async (req, res) => {
  const uploadedFiles = req.files || [];
  let filesPersisted = false;

  try {
    const { cadet_id } = req.params;
    if (uploadedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Select at least one interview sheet to upload',
      });
    }

    const cadet = await cadetDao.getCadetById(cadet_id);
    if (!cadet) {
      await Promise.all(
        uploadedFiles.map((file) => removeStoredFile(file.filename)),
      );
      return res.status(404).json({
        success: false,
        message: 'Cadet not found',
      });
    }

    const existingAttachments =
      await interviewDao.getInterviewAttachments(cadet_id);
    if (existingAttachments.length > 0) {
      await Promise.all(
        uploadedFiles.map((file) => removeStoredFile(file.filename)),
      );
      return res.status(409).json({
        success: false,
        message:
          'Interview sheets are already uploaded. Delete all existing sheets before uploading again.',
      });
    }

    const savedAttachments = await interviewDao.createInterviewAttachments(
      cadet_id,
      uploadedFiles,
      req.user?.id,
    );
    filesPersisted = true;

    try {
      await activityLogDao.createLog(
        req.user.id,
        'Interview Sheets Uploaded',
        `${savedAttachments.length} interview sheet(s) uploaded for cadet ${
          cadet.name_as_in_indos_cert || cadet.cadet_unique_id || cadet_id
        }.`,
        req.ip || req.connection.remoteAddress,
      );
    } catch (logError) {
      console.error('Failed to log interview sheet upload:', logError);
    }

    return res.status(201).json({
      success: true,
      message: `${savedAttachments.length} interview sheet(s) uploaded successfully`,
      data: await interviewDao.getInterviewAttachments(cadet_id),
    });
  } catch (error) {
    if (!filesPersisted) {
      await Promise.all(
        uploadedFiles.map((file) => removeStoredFile(file.filename)),
      );
    }
    console.error('Error uploading interview sheets:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload interview sheets',
      error: error.message,
    });
  }
};

const getInterviewAttachments = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const attachments = await interviewDao.getInterviewAttachments(cadet_id);
    return res.status(200).json({ success: true, data: attachments });
  } catch (error) {
    console.error('Error loading interview sheets:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load interview sheets',
      error: error.message,
    });
  }
};

const getInterviewAttachment = async (req, res) => {
  try {
    const { cadet_id, attachment_id } = req.params;
    const attachment = await interviewDao.getInterviewAttachmentById(
      cadet_id,
      attachment_id,
    );
    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Interview sheet not found',
      });
    }

    const interview = await interviewDao.getInterviewByCadetId(cadet_id);
    const isLegacySheet =
      interview?.interview_sheet_name === attachment.stored_name;

    return sendStoredFile({
      res,
      filename: attachment.stored_name,
      mimeType: attachment.mime_type,
      fallbackData: isLegacySheet ? interview.interview_sheet_data : null,
      fallbackName: attachment.original_name,
    });
  } catch (error) {
    console.error('Error viewing interview sheet:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load interview sheet',
      error: error.message,
    });
  }
};

const deleteInterviewAttachment = async (req, res) => {
  try {
    const { cadet_id, attachment_id } = req.params;
    const attachment = await interviewDao.deleteInterviewAttachment(
      cadet_id,
      attachment_id,
    );
    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Interview sheet not found',
      });
    }

    await removeStoredFile(attachment.stored_name);

    try {
      await activityLogDao.createLog(
        req.user.id,
        'Interview Sheet Deleted',
        `Deleted interview sheet ${attachment.original_name} for cadet ${cadet_id}.`,
        req.ip || req.connection.remoteAddress,
      );
    } catch (logError) {
      console.error('Failed to log interview sheet deletion:', logError);
    }

    return res.status(200).json({
      success: true,
      message: 'Interview sheet deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting interview sheet:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete interview sheet',
      error: error.message,
    });
  }
};

const getInterview = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const interview = await interviewDao.getInterviewByCadetId(cadet_id);

    if (!interview) {
      return res.status(404).json({
        success: false,
        message: 'Interview not found',
      });
    }

    res.status(200).json({
      success: true,
      data: interview,
    });
  } catch (error) {
    console.error('Error in getInterview:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const getInterviewSheet = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const interview = await interviewDao.getInterviewByCadetId(cadet_id);

    if (!interview) {
      return res.status(404).json({
        success: false,
        message: 'Interview sheet not found',
      });
    }

    return sendStoredFile({
      res,
      filename: interview.interview_sheet_name,
      mimeType: interview.interview_sheet_mime_type,
      fallbackData: interview.interview_sheet_data,
      fallbackName: interview.interview_sheet_name || 'interview_sheet',
    });
  } catch (error) {
    console.error('Error in getInterviewSheet:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const getHandwrittenSheet = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const interview = await interviewDao.getInterviewByCadetId(cadet_id);
    if (!interview?.handwritten_sheet_name) {
      return res.status(404).json({
        success: false,
        message: 'Handwritten interview notes not found',
      });
    }

    return sendStoredFile({
      res,
      filename: interview.handwritten_sheet_name,
      mimeType: interview.handwritten_sheet_mime_type || 'application/pdf',
      fallbackName: `handwritten-interview-${cadet_id}.pdf`,
    });
  } catch (error) {
    console.error('Error in getHandwrittenSheet:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load handwritten interview notes',
      error: error.message,
    });
  }
};

module.exports = {
  saveInterview,
  saveHandwrittenSheet,
  deleteHandwrittenSheet,
  getHandwrittenDocuments,
  getHandwrittenDocument,
  deleteHandwrittenDocument,
  uploadInterviewAttachments,
  getInterviewAttachments,
  getInterviewAttachment,
  deleteInterviewAttachment,
  getInterview,
  getInterviewSheet,
  getHandwrittenSheet,
};
