const assessmentDao = require('../dao/assessmentDao');
const activityLogDao = require('../dao/activityLogDao');

const saveAssessment = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const {
      ces_test,
      qa_test,
      english_test,
      essay_writing_mark,
      remarks,
      status,
    } = req.body;

    const assessmentData = {
      cadet_id,
      ces_test,
      qa_test,
      english_test,
      essay_writing_mark,
      remarks,
      status,
    };

    // Handle essay upload if file is provided
    if (req.file) {
      assessmentData.essay_data = req.file.buffer;
      assessmentData.essay_mime_type = req.file.mimetype;
      assessmentData.essay_name = req.file.originalname;
    }

    const id = await assessmentDao.createOrUpdateAssessment(assessmentData);

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
