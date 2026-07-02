const interviewDao = require('../dao/interviewDao');
const activityLogDao = require('../dao/activityLogDao');
const cadetDao = require('../dao/cadetDao');
const {
  WORKFLOW_PHASES,
  DISPLAY_STATUS,
  buildWorkflowUpdate,
} = require('../services/recruitmentWorkflowService');

const saveInterview = async (req, res) => {
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
      interview_sheet_data: null,
      interview_sheet_name: req.file?.filename,
      interview_sheet_mime_type: req.file?.mimetype,
    };

    const id = await interviewDao.createOrUpdateInterview(interviewData);
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
    console.error('Error in saveInterview:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
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

    if (!interview || !interview.interview_sheet_data) {
      return res.status(404).json({
        success: false,
        message: 'Interview sheet not found',
      });
    }

    res.set('Content-Type', interview.interview_sheet_mime_type || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${interview.interview_sheet_name || 'interview_sheet'}"`);
    res.send(interview.interview_sheet_data);
  } catch (error) {
    console.error('Error in getInterviewSheet:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

module.exports = {
  saveInterview,
  getInterview,
  getInterviewSheet,
};
