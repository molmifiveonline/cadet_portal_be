const assessmentDao = require('../dao/assessmentDao');
const activityLogDao = require('../dao/activityLogDao');
const cadetDao = require('../dao/cadetDao');
const {
  WORKFLOW_PHASES,
  DISPLAY_STATUS,
  buildWorkflowUpdate,
} = require('../services/recruitmentWorkflowService');

const saveAssessment = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const {
      assessment_date,
      assessment_time,
      ces_test,
      ces_test_2,
      english_test,
      essay_writing_mark,
      remarks,
      status,
      mark_for_interview,
    } = req.body;

    const normalizedStatus = typeof status === 'string' && status.trim() && status.trim().toLowerCase() !== 'pending' ? status.trim().toLowerCase() : null;

    const assessmentData = {
      cadet_id,
      assessment_date,
      assessment_time,
      ces_test,
      ces_test_2,
      english_test,
      essay_writing_mark,
      remarks,
      status: normalizedStatus,
      mark_for_interview: mark_for_interview == 1,
    };

    // Handle essay upload if file is provided
    if (req.file) {
      assessmentData.essay_data = null;
      assessmentData.essay_mime_type = req.file.mimetype;
      assessmentData.essay_name = req.file.filename;
    }

    const id = await assessmentDao.createOrUpdateAssessment(assessmentData);
    const cadet = await cadetDao.getCadetById(cadet_id);
    const cadetDisplayName =
      cadet?.name_as_in_indos_cert || cadet?.cadet_unique_id || cadet_id;

    // Workflow: keep failed assessments in the assessment queue so they can take attempt 2.
    if (normalizedStatus === 'fail') {
      await cadetDao.updateCadet(
        cadet_id,
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.ASSESSMENT,
          result: 'failed',
          rejectionStage: null,
          status: DISPLAY_STATUS.ASSESSMENT,
        }),
      );
    } else if (normalizedStatus === 'pass') {
      if (assessmentData.mark_for_interview) {
        await cadetDao.updateCadet(
          cadet_id,
          buildWorkflowUpdate({
            phase: WORKFLOW_PHASES.INTERVIEW,
            result: 'queued',
            status: DISPLAY_STATUS.ASSESSMENT,
          }),
        );
      } else {
        await cadetDao.updateCadet(
          cadet_id,
          buildWorkflowUpdate({
            phase: WORKFLOW_PHASES.ASSESSMENT,
            result: 'passed',
            status: DISPLAY_STATUS.ASSESSMENT,
          }),
        );
      }
    }

    // Add activity log
    await activityLogDao.createLog(
      req.user.id,
      'Assessment Saved',
      `Assessment for cadet ${cadetDisplayName} has been saved.`,
      req.ip || req.connection.remoteAddress,
    );

    res.status(200).json({
      success: true,
      message: 'Assessment saved successfully',
      data: { id },
    });
  } catch (error) {
    console.error('Error in saveAssessment:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const getAssessment = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const assessment = await assessmentDao.getAssessmentByCadetId(cadet_id);

    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found',
      });
    }

    res.status(200).json({
      success: true,
      data: assessment,
    });
  } catch (error) {
    console.error('Error in getAssessment:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const downloadEssay = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const essay = await assessmentDao.getAssessmentEssay(cadet_id);

    if (!essay) {
      return res.status(404).json({
        success: false,
        message: 'Essay not found',
      });
    }

    res.set({
      'Content-Type': essay.essay_mime_type,
      'Content-Disposition': `attachment; filename="${essay.essay_name}"`,
    });
    res.send(essay.essay_data);
  } catch (error) {
    console.error('Error in downloadEssay:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const deleteAssessment = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const cadet = await cadetDao.getCadetById(cadet_id);
    const cadetDisplayName =
      cadet?.name_as_in_indos_cert || cadet?.cadet_unique_id || cadet_id;
    await assessmentDao.deleteAssessment(cadet_id);

    // Add activity log
    await activityLogDao.createLog(
      req.user.id,
      'Assessment Deleted',
      `Assessment for cadet ${cadetDisplayName} has been deleted.`,
      req.ip || req.connection.remoteAddress,
    );

    res.status(200).json({
      success: true,
      message: 'Assessment deleted successfully',
    });
  } catch (error) {
    console.error('Error in deleteAssessment:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

module.exports = {
  saveAssessment,
  getAssessment,
  downloadEssay,
  deleteAssessment,
};
