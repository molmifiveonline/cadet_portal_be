const medicalDao = require('../dao/cadetMedicalResultsDao');
const activityLogDao = require('../dao/activityLogDao');
const cadetDao = require('../dao/cadetDao');

const saveMedicalResult = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const {
      medical_date,
      medical_center_id,
      fit_status,
      remarks,
      medical_time,
    } = req.body;

    const medicalData = {
      cadet_id,
      medical_date,
      medical_center_id,
      fit_status,
      remarks,
      medical_time,
      report_data: req.file?.buffer,
      report_name: req.file?.originalname,
      report_mime_type: req.file?.mimetype,
    };

    const id = await medicalDao.createOrUpdateMedicalResult(medicalData);

    // Workflow: Advance to CTV stage if fit
    if (fit_status?.toLowerCase() === 'fit') {
      await cadetDao.updateCadet(cadet_id, { status: 'Medical Completed' });
    } else if (fit_status?.toLowerCase() === 'unfit') {
        await cadetDao.updateCadet(cadet_id, { status: 'Medical Failed' });
    }

    await activityLogDao.createLog(
      req.user.id,
      'Medical Result Saved',
      `Medical result for cadet ID ${cadet_id} has been saved.`,
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
    const { drive_id } = req.body;
    // Logic to confirm candidates - perhaps update status or send emails
    // For now, just return success
    res.status(200).json({
      success: true,
      message: 'Candidates confirmed successfully',
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
    const { drive_id } = req.body;
    // Logic to collect academic data - send emails or generate links
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
    const { drive_id } = req.body;
    // Logic to collect documents - send emails with links
    res.status(200).json({
      success: true,
      message: 'Document collection initiated',
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
