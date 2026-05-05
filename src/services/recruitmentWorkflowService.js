const WORKFLOW_PHASES = {
  UPLOADED: 'uploaded',
  SHORTLISTED: 'shortlisted',
  ASSESSMENT: 'assessment',
  INTERVIEW: 'interview',
  MEDICAL: 'medical',
  SELECTED: 'selected',
  REJECTED: 'rejected',
};

const DISPLAY_STATUS = {
  UPLOADED: 'Uploaded',
  SHORTLISTED: 'Shortlisted',
  ASSESSMENT: 'Assessment',
  INTERVIEWED: 'Interviewed',
  SELECTED: 'Selected',
  REJECTED: 'Rejected',
  CTV_ASSIGNED: 'CTV Assigned',
  ONBOARDED: 'Onboarded',
};

const DRIVE_STATUS = {
  DRAFT: 'Draft',
  REQUESTED: 'Requested',
  RECEIVED: 'Received',
  SUBMITTED: 'Submitted',
  SHORTLISTED: 'Shortlisted',
  ASSESSMENT_COMPLETED: 'Assessment Completed',
  INTERVIEW_COMPLETED: 'Interview Completed',
  MEDICAL_COMPLETED: 'Medical Completed',
  CLOSED: 'Closed',
};

const COMMUNICATION_TYPES = {
  INSTITUTE_REQUEST: 'institute_request',
  INSTITUTE_SUBMISSION: 'institute_submission',
  SHORTLIST: 'shortlist',
  ASSESSMENT_INVITE: 'assessment_invite',
  INTERVIEW_INVITE: 'interview_invite',
  MEDICAL_INVITE: 'medical_invite',
  MEDICAL_CONFIRMATION: 'medical_confirmation',
  ACADEMIC_DATA_REQUEST: 'academic_data_request',
  DOCUMENT_REQUEST: 'document_request',
  DOCUMENT_REUPLOAD: 'document_reupload',
};

const LEGACY_STATUS_MAP = {
  Imported: { workflow_phase: WORKFLOW_PHASES.UPLOADED, workflow_result: 'pending' },
  active: { workflow_phase: WORKFLOW_PHASES.UPLOADED, workflow_result: 'pending' },
  'Eligible for Assessment': { workflow_phase: WORKFLOW_PHASES.SHORTLISTED, workflow_result: 'eligible' },
  'Assessment Passed': { workflow_phase: WORKFLOW_PHASES.ASSESSMENT, workflow_result: 'passed' },
  'Assessment Failed': {
    workflow_phase: WORKFLOW_PHASES.REJECTED,
    workflow_result: 'failed',
    rejection_stage: WORKFLOW_PHASES.ASSESSMENT,
  },
  'Eligible for Interview': { workflow_phase: WORKFLOW_PHASES.ASSESSMENT, workflow_result: 'passed' },
  'Interview Selected': { workflow_phase: WORKFLOW_PHASES.SELECTED, workflow_result: 'selected' },
  'Interview Failed': {
    workflow_phase: WORKFLOW_PHASES.REJECTED,
    workflow_result: 'failed',
    rejection_stage: WORKFLOW_PHASES.INTERVIEW,
  },
  'Eligible for Medical': { workflow_phase: WORKFLOW_PHASES.SELECTED, workflow_result: 'medical_pending' },
  'Medical Completed': { workflow_phase: WORKFLOW_PHASES.SELECTED, workflow_result: 'medical_passed' },
  'Medical Failed': {
    workflow_phase: WORKFLOW_PHASES.REJECTED,
    workflow_result: 'failed',
    rejection_stage: WORKFLOW_PHASES.MEDICAL,
  },
  'CTV Assigned': { workflow_phase: WORKFLOW_PHASES.SELECTED, workflow_result: 'ctv_assigned' },
  Onboarded: { workflow_phase: WORKFLOW_PHASES.SELECTED, workflow_result: 'onboarded' },
  Rejected: {
    workflow_phase: WORKFLOW_PHASES.REJECTED,
    workflow_result: 'failed',
  },
};

const normalizeLegacyWorkflow = (status) => {
  if (!status) {
    return {
      workflow_phase: WORKFLOW_PHASES.UPLOADED,
      workflow_result: 'pending',
      rejection_stage: null,
    };
  }

  return (
    LEGACY_STATUS_MAP[status] || {
      workflow_phase: WORKFLOW_PHASES.UPLOADED,
      workflow_result: 'pending',
      rejection_stage: null,
    }
  );
};

const getCadetWorkflow = (cadet = {}) => {
  const fallback = normalizeLegacyWorkflow(cadet.status);

  return {
    workflow_phase: cadet.workflow_phase || fallback.workflow_phase,
    workflow_result: cadet.workflow_result || fallback.workflow_result,
    rejection_stage: cadet.rejection_stage || fallback.rejection_stage || null,
  };
};

const deriveDisplayStatus = (cadet = {}) => {
  const { workflow_phase, workflow_result } = getCadetWorkflow(cadet);
  const explicitStatuses = new Set(Object.values(DISPLAY_STATUS));

  if (explicitStatuses.has(cadet.status)) {
    return cadet.status;
  }

  if (cadet.status === DISPLAY_STATUS.CTV_ASSIGNED || workflow_result === 'ctv_assigned') {
    return DISPLAY_STATUS.CTV_ASSIGNED;
  }

  if (cadet.status === DISPLAY_STATUS.ONBOARDED || workflow_result === 'onboarded') {
    return DISPLAY_STATUS.ONBOARDED;
  }

  switch (workflow_phase) {
    case WORKFLOW_PHASES.UPLOADED:
      return DISPLAY_STATUS.UPLOADED;
    case WORKFLOW_PHASES.SHORTLISTED:
      return DISPLAY_STATUS.SHORTLISTED;
    case WORKFLOW_PHASES.ASSESSMENT:
      return DISPLAY_STATUS.ASSESSMENT;
    case WORKFLOW_PHASES.INTERVIEW:
      return DISPLAY_STATUS.INTERVIEWED;
    case WORKFLOW_PHASES.MEDICAL:
      return DISPLAY_STATUS.SELECTED;
    case WORKFLOW_PHASES.SELECTED:
      return DISPLAY_STATUS.SELECTED;
    case WORKFLOW_PHASES.REJECTED:
      return DISPLAY_STATUS.REJECTED;
    default:
      return DISPLAY_STATUS.UPLOADED;
  }
};

const isEligibleForAssessment = (cadet = {}) => {
  const { workflow_phase } = getCadetWorkflow(cadet);
  return [WORKFLOW_PHASES.SHORTLISTED, WORKFLOW_PHASES.ASSESSMENT, WORKFLOW_PHASES.INTERVIEW, WORKFLOW_PHASES.MEDICAL, WORKFLOW_PHASES.SELECTED].includes(workflow_phase);
};

const buildWorkflowUpdate = ({
  phase,
  result = 'pending',
  rejectionStage = null,
  status,
  extraFields = {},
}) => ({
  workflow_phase: phase,
  workflow_result: result,
  rejection_stage: rejectionStage,
  workflow_updated_at: new Date(),
  status,
  ...extraFields,
});

const hydrateCadetWorkflow = (cadet = {}) => {
  const display_status = deriveDisplayStatus(cadet);
  const cv_needed = !Number(cadet.has_cv || 0);
  const assessment_eligible = isEligibleForAssessment(cadet);
  const cadet_percentage = cadet.cadet_percentage || cadet.imu_avg_all_semester_percentage || cadet.twelfth_pcm_avg_percentage || cadet.tenth_avg_percentage || null;

  return {
    ...cadet,
    display_status,
    status: display_status,
    cv_needed,
    assessment_eligible,
    cadet_percentage,
  };
};

module.exports = {
  WORKFLOW_PHASES,
  DISPLAY_STATUS,
  DRIVE_STATUS,
  COMMUNICATION_TYPES,
  normalizeLegacyWorkflow,
  getCadetWorkflow,
  deriveDisplayStatus,
  isEligibleForAssessment,
  buildWorkflowUpdate,
  hydrateCadetWorkflow,
};
