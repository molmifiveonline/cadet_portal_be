const interviewDao = require('../dao/interviewDao');
const activityLogDao = require('../dao/activityLogDao');
const cadetDao = require('../dao/cadetDao');

const saveInterview = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const {
      interview_date,
      panel_members,
      evaluation_score,
      remarks,
      final_decision,
      total_score,
    } = req.body;

    const interviewData = {
      cadet_id,
      interview_date,
      panel_members,
      evaluation_score,
      remarks,
      final_decision,
      total_score,
      interview_sheet_data: req.file?.buffer,
      interview_sheet_name: req.file?.originalname,
      interview_sheet_mime_type: req.file?.mimetype,
    };

    const id = await interviewDao.createOrUpdateInterview(interviewData);

    // Workflow: Advance to Medical stage if selected
    if (final_decision === 'selected') {
      await cadetDao.updateCadet(cadet_id, { status: 'Eligible for Medical' });
    } else if (final_decision === 'rejected') {
      await cadetDao.updateCadet(cadet_id, { status: 'Interview Failed' });
    }

    await activityLogDao.createLog(
      req.user.id,
      'Interview Saved',
      `Interview for cadet ID ${cadet_id} has been saved.`,
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
