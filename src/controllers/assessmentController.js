const assessmentDao = require('../dao/assessmentDao');
const activityLogDao = require('../dao/activityLogDao');
const cadetDao = require('../dao/cadetDao');

const saveAssessment = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const {
      ces_test,
      ces_test_2,
      qa_test,
      english_test,
      essay_writing_mark,
      remarks,
      status,
      mark_for_interview,
    } = req.body;

    const assessmentData = {
      cadet_id,
      ces_test,
      ces_test_2,
      qa_test,
      english_test,
      essay_writing_mark,
      remarks,
      status,
      mark_for_interview: mark_for_interview === 'true' || mark_for_interview === true || mark_for_interview === 1,
    };

    // Handle essay upload if file is provided
    if (req.file) {
      assessmentData.essay_data = req.file.buffer;
      assessmentData.essay_mime_type = req.file.mimetype;
      assessmentData.essay_name = req.file.originalname;
    }

    const id = await assessmentDao.createOrUpdateAssessment(assessmentData);

    // Workflow: Update cadet status if marked for interview or failed
    if (status === 'fail') {
      await cadetDao.updateCadet(cadet_id, { status: 'Assessment Failed' });
    } else if (status === 'pass') {
      if (assessmentData.mark_for_interview) {
        await cadetDao.updateCadet(cadet_id, { status: 'Eligible for Interview' });
      } else {
        await cadetDao.updateCadet(cadet_id, { status: 'Assessment Passed' });
      }
    }

    // Add activity log
    await activityLogDao.createLog(
      req.user.id,
      'Assessment Saved',
      `Assessment for cadet ID ${cadet_id} has been saved.`,
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
    await assessmentDao.deleteAssessment(cadet_id);

    // Add activity log
    await activityLogDao.createLog(
      req.user.id,
      'Assessment Deleted',
      `Assessment for cadet ID ${cadet_id} has been deleted.`,
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
