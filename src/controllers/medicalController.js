const medicalDao = require('../dao/cadetMedicalResultsDao');
const activityLogDao = require('../dao/activityLogDao');
const cadetDao = require('../dao/cadetDao');

const saveMedicalResult = async (req, res) => {
  try {
    const { cadet_id } = req.params;
    const {
      medical_date,
      medical_center,
      fit_status,
      remarks,
    } = req.body;

    const medicalData = {
      cadet_id,
      medical_date,
      medical_center,
      fit_status,
      remarks,
    };

    const id = await medicalDao.createOrUpdateMedicalResult(medicalData);

    // Workflow: Advance to CTV stage if fit
    if (fit_status?.toLowerCase() === 'fit') {
      await cadetDao.updateCadet(cadet_id, { status: 'CTV Assigned' });
    } else if (fit_status?.toLowerCase() === 'unfit') {
        await cadetDao.updateCadet(cadet_id, { status: 'Medical Failed' });
    }

    await activityLogDao.createLog(
      req.user.id,
      'Medical Result Saved',
      `Medical result for cadet ID ${cadet_id} has been saved.`,
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

module.exports = {
  saveMedicalResult,
  getMedicalResult,
};
