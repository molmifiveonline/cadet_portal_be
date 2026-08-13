const medicalDao = require('../dao/cadetMedicalResultsDao');
const activityLogDao = require('../dao/activityLogDao');
const cadetDao = require('../dao/cadetDao');
const instituteDao = require('../dao/instituteDao');
const recruitmentDriveDao = require('../dao/recruitmentDriveDao');
const recruitmentCommunicationDao = require('../dao/recruitmentCommunicationDao');
const medicalReportDao = require('../dao/medicalReportDao');
const medicalCenterDao = require('../dao/medicalCenterDao');
const documentController = require('./documentController');
const {
  WORKFLOW_PHASES,
  DISPLAY_STATUS,
  buildWorkflowUpdate,
  COMMUNICATION_TYPES,
} = require('../services/recruitmentWorkflowService');
const { FRONTEND_URL } = require('../config/constants');
const {
  logAndSendEmail,
  logAndSendBatchEmail,
  emailTemplates,
} = require('../services/recruitmentCommunicationService');

const getCadetDisplayName = (cadet = {}) =>
  cadet.name_as_in_indos_cert || cadet.cadet_unique_id || cadet.id || 'Cadet';

const hasPassedMedical = (cadet = {}) => {
  const medicalDecision = String(cadet.medical_final_decision || '').toLowerCase();
  return (
    cadet.workflow_result === 'medical_passed' ||
    ['pass', 'fit'].includes(medicalDecision)
  );
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

const saveMedicalResult = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const {
      final_decision,
      remarks,
      appointments,
      report_results,
    } = req.body;

    let parsedAppointments = [];
    try {
      parsedAppointments = appointments ? JSON.parse(appointments) : [];
    } catch(e) {}

    let parsedReportResults = [];
    try {
      parsedReportResults = report_results ? JSON.parse(report_results) : [];
    } catch(e) {}

    const normalizedDecision = String(final_decision || '').toLowerCase();
    const resolvedDecision = ['pass', 'fit'].includes(normalizedDecision)
      ? 'pass'
      : normalizedDecision === 'retest'
      ? 'retest'
      : 'fail';

    const medicalData = {
      cadet_id,
      final_decision: resolvedDecision,
      remarks,
      appointments: parsedAppointments,
      report_results: parsedReportResults,
      report_data: null,
      files: req.files || [],
    };

    const id = await medicalDao.createOrUpdateMedicalResult(medicalData);
    const cadet = await cadetDao.getCadetById(cadet_id);
    const cadetDisplayName =
      cadet?.name_as_in_indos_cert || cadet?.cadet_unique_id || cadet_id;

    if (resolvedDecision === 'pass') {
      const currentResult = cadet.workflow_result;
      const currentPhase = cadet.workflow_phase;
      const shouldKeepResult = ['confirmed', 'academic_data_collected'].includes(currentResult) || currentPhase === WORKFLOW_PHASES.SELECTED;

      await cadetDao.updateCadet(
        cadet_id,
        buildWorkflowUpdate({
          phase: currentPhase === WORKFLOW_PHASES.SELECTED ? WORKFLOW_PHASES.SELECTED : WORKFLOW_PHASES.MEDICAL,
          result: shouldKeepResult ? currentResult : 'medical_passed',
          status: DISPLAY_STATUS.SELECTED,
        }),
      );
    } else if (resolvedDecision === 'retest') {
      const currentPhase = cadet.workflow_phase;
      await cadetDao.updateCadet(
        cadet_id,
        buildWorkflowUpdate({
          phase: currentPhase === WORKFLOW_PHASES.SELECTED ? WORKFLOW_PHASES.SELECTED : WORKFLOW_PHASES.MEDICAL,
          result: 'medical_pending',
          status: DISPLAY_STATUS.SELECTED,
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
    const { drive_id, remarks = '', cadet_ids } = req.body;
    if (!drive_id) {
      return res.status(400).json({ success: false, message: 'drive_id is required' });
    }

    const drive = await recruitmentDriveDao.getRecruitmentDriveById(drive_id);
    if (!drive) {
      return res.status(404).json({ success: false, message: 'Recruitment drive not found' });
    }

    if (!Array.isArray(cadet_ids) || cadet_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Select at least one medically passed cadet to confirm',
      });
    }

    const requestedIds = [...new Set(cadet_ids.map(String))];
    const selectedCadets = await cadetDao.getCadetsByIds(requestedIds);
    const selectedIdSet = new Set(selectedCadets.map((cadet) => String(cadet.id)));
    const missingIds = requestedIds.filter((id) => !selectedIdSet.has(id));
    const outsideDrive = selectedCadets.filter(
      (cadet) => String(cadet.drive_id) !== String(drive_id),
    );
    const notPassed = selectedCadets.filter(
      (cadet) =>
        String(cadet.drive_id) === String(drive_id) &&
        !hasPassedMedical(cadet),
    );

    if (missingIds.length > 0 || outsideDrive.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'One or more selected cadets do not belong to this recruitment drive',
      });
    }

    if (notPassed.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Only cadets who have passed the medical exam can be confirmed',
      });
    }

    const recipient = await getInstituteRecipient(drive.institute_id);

    if (selectedCadets.length > 0) {
      await cadetDao.bulkUpdateCadets(
        selectedCadets.map((c) => c.id),
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.MEDICAL,
          result: 'confirmed',
          status: DISPLAY_STATUS.SELECTED,
        }),
      );
    }

    if (recipient) {
      await logAndSendEmail({
        to: recipient.email,
        template: emailTemplates.instituteSelectionConfirmation,
        templateData: {
          instituteName: recipient.institute.institute_name,
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
    const { drive_id, cadet_ids } = req.body;
    if (!drive_id) {
      return res.status(400).json({ success: false, message: 'drive_id is required' });
    }

    const drive = await recruitmentDriveDao.getRecruitmentDriveById(drive_id);
    if (!drive) {
      return res.status(404).json({ success: false, message: 'Recruitment drive not found' });
    }

    let selectedCadets;
    if (Array.isArray(cadet_ids) && cadet_ids.length > 0) {
      selectedCadets = await cadetDao.getCadetsByIds(cadet_ids);
    } else {
      selectedCadets = await cadetDao.getDriveCadets(drive_id, { queue: 'selected' });
    }

    const recipient = await getInstituteRecipient(drive.institute_id);

    if (recipient) {
      await logAndSendEmail({
        to: recipient.email,
        template: emailTemplates.stageInviteBatch,
        templateData: {
          subject: `Pending academic data request for ${drive.drive_name}`,
          recipientName: recipient.institute.institute_name,
          message: 'Please share the pending academic data for the selected candidates.',
          showLocation: false,
          showLink: false,
          showDate: false,
          showTime: false,
          showRemarks: false,
          cadets: selectedCadets.map((cadet) => ({
            cadetName: getCadetDisplayName(cadet),
            cadetUniqueId: cadet.cadet_unique_id,
          })),
        },
        drive_id,
        institute_id: drive.institute_id,
        communication_type: COMMUNICATION_TYPES.ACADEMIC_DATA_REQUEST,
        remarks: 'Academic data collection request',
        sent_by: req.user?.id || null,
      });
    }

    if (selectedCadets.length > 0) {
      await cadetDao.bulkUpdateCadets(
        selectedCadets.map((c) => c.id),
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.MEDICAL,
          result: 'academic_data_collected',
          status: DISPLAY_STATUS.SELECTED,
        }),
      );
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
    const { drive_id, remarks = '', document_link = '', cadet_ids } = req.body;
    if (!drive_id) {
      return res.status(400).json({ success: false, message: 'drive_id is required' });
    }

    let cadets;
    if (Array.isArray(cadet_ids) && cadet_ids.length > 0) {
      cadets = await cadetDao.getCadetsByIds(cadet_ids);
    } else {
      cadets = await cadetDao.getDriveCadets(drive_id, { queue: 'selected' });
    }

    const instituteCache = new Map();
    const emailBatches = new Map();

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

      const recipient = await getInstituteRecipient(cadet.institute_id, instituteCache);
      if (recipient) {
        addDocumentRequestBatchItem(emailBatches, recipient, {
          drive_id,
          cadetId: cadet.id,
          cadetName: getCadetDisplayName(cadet),
          cadetUniqueId: cadet.cadet_unique_id,
          institute_id: cadet.institute_id,
          documentLink: candidateLink,
          remarks,
        });
      }
    }

    for (const batch of emailBatches.values()) {
      await logAndSendBatchEmail({
        to: batch.recipient.email,
        template: emailTemplates.documentUploadRequestBatch,
        templateData: {
          subject: 'Document upload requested - MOLMI',
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
            subject: 'Document upload requested - MOLMI',
            ...item,
          },
        })),
      });
    }

    if (cadets.length > 0) {
      await cadetDao.bulkUpdateCadets(
        cadets.map((c) => c.id),
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.SELECTED,
          result: 'medical_passed',
          status: DISPLAY_STATUS.SELECTED,
          extraFields: {
            selected_at: new Date(),
          },
        }),
      );
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

const sendRetestInvite = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const { cadets = [] } = req.body;
    
    const cadetInvite = cadets.find(c => String(c.cadet_id) === String(cadet_id));
    if (!cadetInvite) {
      return res.status(400).json({ success: false, message: 'Cadet details missing in request' });
    }

    const cadet = await cadetDao.getCadetById(cadet_id);
    if (!cadet) {
      return res.status(404).json({ success: false, message: 'Cadet not found' });
    }

    const { data: allReports } = await medicalReportDao.getAllMedicalReports();
    const reportMap = new Map(allReports.map(r => [r.id, r.name]));

    const { data: allCenters } = await medicalCenterDao.getAllMedicalCenters(1000, 0);
    const centerMap = new Map(allCenters.map(c => [c.id, c.center_name]));

    const recipient = await getInstituteRecipient(cadet.institute_id);
    if (!recipient) {
      return res.status(404).json({ success: false, message: 'Institute recipient not found' });
    }

    const existingResult = await medicalDao.getMedicalResultByCadetId(cadet.id);
    let existingAppointments = [];
    if (existingResult && existingResult.appointments) {
      try {
        existingAppointments = typeof existingResult.appointments === 'string'
          ? JSON.parse(existingResult.appointments)
          : (existingResult.appointments || []);
      } catch (e) {
        console.error('Error parsing existing appointments:', e);
      }
    }

    const newAppointments = (cadetInvite.appointments || []).map(appt => ({
      ...appt,
      is_retest: true
    }));

    const combinedAppointments = [...existingAppointments, ...newAppointments];

    await medicalDao.createOrUpdateMedicalResult({
      cadet_id: cadet.id,
      appointments: combinedAppointments,
      invite_remark: cadetInvite.remarks,
      final_decision: 'retest'
    });

    await cadetDao.updateCadet(
      cadet.id,
      buildWorkflowUpdate({
        phase: cadet.workflow_phase === WORKFLOW_PHASES.SELECTED ? WORKFLOW_PHASES.SELECTED : WORKFLOW_PHASES.MEDICAL,
        result: 'medical_pending',
        status: DISPLAY_STATUS.SELECTED,
      }),
    );

    const appointmentDetails = newAppointments.map(appt => {
      const reportNames = (appt.medical_reports || []).map(rId => reportMap.get(rId) || rId);
      const centerName = centerMap.get(appt.medical_center_id) || appt.medical_center_name || "Medical Center";
      return {
        center_name: centerName,
        date: appt.medical_date,
        time: appt.medical_time,
        report_names: reportNames
      };
    });

    const item = {
      drive_id: cadet.drive_id,
      cadetId: cadet.id,
      cadetName: getCadetDisplayName(cadet),
      cadetUniqueId: cadet.cadet_unique_id,
      institute_id: cadet.institute_id,
      appointmentDetails,
      remarks: cadetInvite.remarks,
    };

    await logAndSendBatchEmail({
      to: recipient.email,
      template: emailTemplates.stageInviteBatch,
      templateData: {
        subject: "Medical Retest Invite - MOLMI",
        recipientName: recipient.institute.institute_name,
        message: "The following cadet(s) have been scheduled for a medical retest. Please review the appointment details below.",
        dateLabel: "Date",
        timeLabel: "Time",
        locationLabel: "Medical Location",
        cadets: [item],
        showLocation: true,
        showLink: true,
      },
      communications: [{
        drive_id: cadet.drive_id,
        cadet_id: cadet.id,
        institute_id: cadet.institute_id,
        communication_type: COMMUNICATION_TYPES.MEDICAL_INVITE,
        remarks: item.remarks,
        sent_by: req.user?.id || null,
        payload_json: {
          subject: "Medical Retest Invite - MOLMI",
          ...item,
        },
      }],
    });

    await activityLogDao.createLog(
      req.user.id,
      'Medical Retest Invite Sent',
      `Medical retest invite sent for cadet ${getCadetDisplayName(cadet)}.`,
      req.ip || req.connection.remoteAddress
    );

    res.json({ success: true, message: 'Retest invite sent successfully' });
  } catch (error) {
    console.error('Error in sendRetestInvite:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

module.exports = {
  saveMedicalResult,
  getMedicalResult,
  bulkConfirmCandidates,
  bulkCollectAcademicData,
  bulkCollectDocuments,
  sendRetestInvite,
};
