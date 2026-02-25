const shortlistService = require('../services/shortlistService');
const cvTokenService = require('../services/cvTokenService');
const cadetDao = require('../dao/cadetDao');
const instituteDao = require('../dao/instituteDao');
const activityLogDao = require('../dao/activityLogDao');
const emailService = require('../services/emailService');

/**
 * Get CV form data by token (public endpoint)
 */
const getCVFormByToken = async (req, res) => {
  try {
    const { token } = req.params;

    // Validate token
    const validationResult = await cvTokenService.validateCVToken(token);

    if (!validationResult.valid) {
      return res.status(400).json({
        success: false,
        message: validationResult.message,
      });
    }

    const { data: tokenData } = validationResult;

    // Get cadet CV data
    const cadetData = await cadetDao.getCadetById(tokenData.cadet_id);

    if (!cadetData) {
      return res.status(404).json({
        success: false,
        message: 'Cadet not found',
      });
    }

    // Return cadet data with token info
    res.json({
      success: true,
      data: {
        cadet: cadetData,
        token_info: {
          expires_at: tokenData.expires_at,
          institute_name: tokenData.institute_name,
          status: tokenData.status,
        },
      },
    });
  } catch (error) {
    console.error('Get CV Form By Token Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching CV form data',
      error: error.message,
    });
  }
};

/**
 * Submit CV form data (public endpoint)
 */
const submitCVForm = async (req, res) => {
  try {
    const { token } = req.params;
    const cvFormData = req.body;

    // Validate token
    const validationResult = await cvTokenService.validateCVToken(token);

    if (!validationResult.valid) {
      return res.status(400).json({
        success: false,
        message: validationResult.message,
      });
    }

    const { data: tokenData } = validationResult;

    // Update cadet CV data
    await cadetDao.updateCVData(tokenData.cadet_id, cvFormData);

    // Mark token as used
    await cvTokenService.markTokenUsed(token);

    res.json({
      success: true,
      message: 'CV form submitted successfully',
    });
  } catch (error) {
    console.error('Submit CV Form Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting CV form',
      error: error.message,
    });
  }
};

/**
 * Send CV form emails to institute for their shortlisted cadets (admin only)
 */
const sendCVFormEmail = async (req, res) => {
  try {
    const { instituteId } = req.body;

    if (!instituteId || instituteId === 'all') {
      return res.status(400).json({
        success: false,
        message: 'Please select a specific institute',
      });
    }

    // Get institute details
    const institute = await instituteDao.getInstituteById(instituteId);
    if (!institute) {
      return res.status(404).json({
        success: false,
        message: 'Institute not found',
      });
    }

    // Get shortlisted cadets for this institute
    const { data: cadets } = await shortlistService.getShortlistedCadets(
      10000,
      0,
      { instituteId },
    );

    if (cadets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No shortlisted cadets found for this institute',
      });
    }

    // Generate tokens for all shortlisted cadets
    const tokens = [];
    for (const cadet of cadets) {
      const tokenData = await cvTokenService.generateCVToken(
        cadet.id,
        instituteId,
        7, // 7 days expiration
      );
      tokens.push({
        ...tokenData,
        cadet_name: cadet.name_as_in_indos_cert,
        cadet_email: cadet.email_id,
      });
    }

    // Send email with all CV form links
    await emailService.sendCVFormEmail(institute, tokens);

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'SEND_CV_FORMS',
        `Sent CV form emails for ${cadets.length} shortlisted cadets to ${institute.institute_name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      success: true,
      message: `CV form emails sent successfully for ${cadets.length} cadets`,
      data: {
        institute_name: institute.institute_name,
        cadet_count: cadets.length,
        tokens_generated: tokens.length,
      },
    });
  } catch (error) {
    console.error('Send CV Form Email Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending CV form emails',
      error: error.message,
    });
  }
};

/**
 * Resend CV form email for a specific cadet (admin only)
 */
const resendCVFormEmail = async (req, res) => {
  try {
    const { cadetId } = req.params;

    // Get cadet details
    const cadet = await cadetDao.getCadetById(cadetId);
    if (!cadet) {
      return res.status(404).json({
        success: false,
        message: 'Cadet not found',
      });
    }

    // Get institute details
    const institute = await instituteDao.getInstituteById(cadet.institute_id);
    if (!institute) {
      return res.status(404).json({
        success: false,
        message: 'Institute not found',
      });
    }

    // Regenerate token
    const tokenData = await cvTokenService.regenerateToken(
      cadetId,
      cadet.institute_id,
    );

    // Send email
    await emailService.sendCVFormEmail(institute, [
      {
        ...tokenData,
        cadet_name: cadet.name_as_in_indos_cert,
        cadet_email: cadet.email_id,
      },
    ]);

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'RESEND_CV_FORM',
        `Resent CV form email for cadet ${cadet.name_as_in_indos_cert} to ${institute.institute_name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      success: true,
      message: 'CV form email resent successfully',
    });
  } catch (error) {
    console.error('Resend CV Form Email Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resending CV form email',
      error: error.message,
    });
  }
};

/**
 * Get CV token status for a cadet (admin only)
 */
const getCVTokenStatus = async (req, res) => {
  try {
    const { cadetId } = req.params;

    const tokens = await cvTokenService.getCadetTokens(cadetId);

    res.json({
      success: true,
      data: tokens,
    });
  } catch (error) {
    console.error('Get CV Token Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching token status',
      error: error.message,
    });
  }
};

module.exports = {
  getCVFormByToken,
  submitCVForm,
  sendCVFormEmail,
  resendCVFormEmail,
  getCVTokenStatus,
};
