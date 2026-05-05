const medicalDao = require('../dao/cadetMedicalResultsDao');
const activityLogDao = require('../dao/activityLogDao');
const cadetDao = require('../dao/cadetDao');
const instituteDao = require('../dao/instituteDao');
const recruitmentDriveDao = require('../dao/recruitmentDriveDao');
const recruitmentCommunicationDao = require('../dao/recruitmentCommunicationDao');
const documentController = require('./documentController');
const {
  WORKFLOW_PHASES,
  DISPLAY_STATUS,
  buildWorkflowUpdate,
  COMMUNICATION_TYPES,
} = require('../services/recruitmentWorkflowService');
const { FRONTEND_URL } = require('../config/constants');
const { logAndSendEmail, emailTemplates } = require('../services/recruitmentCommunicationService');

const saveMedicalResult = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const {
      medical_date,
      medical_center_id,
      fit_status,
      final_decision,
      remarks,
      medical_time,
      psychometric_status,
      profiling_status,
    } = req.body;

    const normalizedDecision = String(final_decision || fit_status || '').toLowerCase();
    const resolvedDecision = ['pass', 'fit'].includes(normalizedDecision) ? 'pass' : 'fail';

    const medicalData = {
      cadet_id,
      medical_date,
      medical_center_id,
      fit_status,
      final_decision: resolvedDecision,
      remarks,
      medical_time,
      psychometric_status,
      profiling_status,
      report_data: req.file?.buffer,
      report_name: req.file?.originalname,
      report_mime_type: req.file?.mimetype,
    };

    const id = await medicalDao.createOrUpdateMedicalResult(medicalData);
    const cadet = await cadetDao.getCadetById(cadet_id);
    const cadetDisplayName =
      cadet?.name_as_in_indos_cert || cadet?.cadet_unique_id || cadet_id;

    if (resolvedDecision === 'pass') {
      await cadetDao.updateCadet(
        cadet_id,
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.SELECTED,
          result: 'medical_passed',
          status: DISPLAY_STATUS.SELECTED,
          extraFields: {
            selected_at: new Date(),
          },
        }),
      );
    } else {
      await cadetDao.updateCadet(
        cadet_id,
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.REJECTED,
          result: 'failed',
          rejectionStage: WORKFLOW_PHASES.MEDICAL,
          status: DISPLAY_STATUS.REJECTED,
        }),
      );
    }

    await activityLogDao.createLog(
      req.user.id,
      'Medical Result Saved',
      `Medical result for cadet ${cadetDisplayName} has been saved.`,
      req.ip || req.connection.remoteAddress
    );

    res.status(200).json({
      success: true,
      message: 'Medical result saved successfully',
      data: { id },
    });
  } catch (error) {
    console.error('Error in saveMedicalResult:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const getMedicalResult = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const result = await medicalDao.getMedicalResultByCadetId(cadet_id);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Medical result not found',
      });
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error in getMedicalResult:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const bulkConfirmCandidates = async (req, res) => {
  try {
    const { drive_id, remarks } = req.body;
    if (!drive_id) {
      return res.status(400).json({ success: false, message: 'drive_id is required' });
    }

    const drive = await recruitmentDriveDao.getRecruitmentDriveById(drive_id);
    if (!drive) {
      return res.status(404).json({ success: false, message: 'Recruitment drive not found' });
    }

    const selectedCadets = await cadetDao.getDriveCadets(drive_id, { queue: 'selected' });
    const institute = await instituteDao.getInstituteById(drive.institute_id);

    let targetEmail = '';
    if (typeof institute.contact_emails === 'string') {
      try {
        institute.contact_emails = JSON.parse(institute.contact_emails);
      } catch (error) {}
    }
    if (Array.isArray(institute.contact_emails) && institute.contact_emails.length > 0) {
      targetEmail = institute.contact_emails.find((contact) => contact.isDefault)?.email || institute.contact_emails[0].email;
    }

    if (targetEmail) {
      await logAndSendEmail({
        to: targetEmail,
        template: emailTemplates.instituteSelectionConfirmation,
        templateData: {
          instituteName: institute.institute_name,
          driveName: drive.drive_name,
          cadets: selectedCadets,
          remarks,
        },
        drive_id,
        institute_id: drive.institute_id,
        communication_type: COMMUNICATION_TYPES.MEDICAL_CONFIRMATION,
        remarks,
        sent_by: req.user?.id || null,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Candidates confirmed successfully',
      data: {
        confirmed_count: selectedCadets.length,
      },
    });
  } catch (error) {
    console.error('Error in bulkConfirmCandidates:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const bulkCollectAcademicData = async (req, res) => {
  try {
    const { drive_id, remarks, form_link } = req.body;
    if (!drive_id) {
      return res.status(400).json({ success: false, message: 'drive_id is required' });
    }

    const drive = await recruitmentDriveDao.getRecruitmentDriveById(drive_id);
    if (!drive) {
      return res.status(404).json({ success: false, message: 'Recruitment drive not found' });
    }

    const institute = await instituteDao.getInstituteById(drive.institute_id);
    let targetEmail = '';
    if (typeof institute.contact_emails === 'string') {
      try {
        institute.contact_emails = JSON.parse(institute.contact_emails);
      } catch (error) {}
    }
    if (Array.isArray(institute.contact_emails) && institute.contact_emails.length > 0) {
      targetEmail = institute.contact_emails.find((contact) => contact.isDefault)?.email || institute.contact_emails[0].email;
    }

    if (targetEmail) {
      await logAndSendEmail({
        to: targetEmail,
        template: emailTemplates.stageInvite,
        templateData: {
          subject: `Pending academic data request for ${drive.drive_name}`,
          recipientName: institute.institute_name,
          message: 'Please share the pending academic data for the selected candidates using the link below.',
          documentLink: form_link || process.env.PENDING_ACADEMIC_DATA_LINK || '',
          remarks,
        },
        drive_id,
        institute_id: drive.institute_id,
        communication_type: COMMUNICATION_TYPES.ACADEMIC_DATA_REQUEST,
        remarks,
        sent_by: req.user?.id || null,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Academic data collection initiated',
    });
  } catch (error) {
    console.error('Error in bulkCollectAcademicData:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const bulkCollectDocuments = async (req, res) => {
  try {
    const { drive_id, remarks, document_link } = req.body;
    if (!drive_id) {
      return res.status(400).json({ success: false, message: 'drive_id is required' });
    }

    const cadets = await cadetDao.getDriveCadets(drive_id, { queue: 'selected' });

    for (const cadet of cadets) {
      const candidateLink =
        document_link ||
        process.env.CANDIDATE_DOCUMENT_UPLOAD_LINK ||
        `${FRONTEND_URL || ''}/drives/${drive_id}`;

      await documentController.createExternalDocumentRequest({
        cadet,
        documentType: 'OTHER',
        link: candidateLink,
        sentBy: req.user?.id || null,
        remarks,
      });

      if (cadet.email_id) {
        await logAndSendEmail({
          to: cadet.email_id,
          template: emailTemplates.stageInvite,
          templateData: {
            subject: `Document upload requested for ${cadet.name_as_in_indos_cert}`,
            recipientName: cadet.name_as_in_indos_cert,
            message: 'Please upload the requested candidate documents using the link below.',
            documentLink: candidateLink,
            remarks,
          },
          drive_id,
          cadet_id: cadet.id,
          institute_id: cadet.institute_id,
          communication_type: COMMUNICATION_TYPES.DOCUMENT_REQUEST,
          remarks,
          sent_by: req.user?.id || null,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Document collection initiated',
      data: {
        requested_count: cadets.length,
      },
    });
  } catch (error) {
    console.error('Error in bulkCollectDocuments:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

module.exports = {
  saveMedicalResult,
  getMedicalResult,
  bulkConfirmCandidates,
  bulkCollectAcademicData,
  bulkCollectDocuments,
};
