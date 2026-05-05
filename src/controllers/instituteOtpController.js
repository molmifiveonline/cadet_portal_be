const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const instituteDao = require('../dao/instituteDao');
const { sendEmail, emailTemplates } = require('../services/emailService');
const {
  JWT_SECRET,
  JWT_EXPIRE,
  ROLES,
  INSTITUTE_OTP_EXPIRY_MINUTES,
} = require('../config/constants');
const activityLogDao = require('../dao/activityLogDao');

const INSTITUTE_RECRUITMENT_DRIVES_ROUTE = '/drives';

const otpError = (res, status, message, code) => (
  res.status(status).json({
    success: false,
    message,
    code,
    isInstituteOtpError: true,
  })
);

const requestInstituteOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email address is required' });
    }

    const institute = await instituteDao.getInstituteByEmail(email.toLowerCase().trim());

    if (!institute) {
      return res.status(404).json({ message: 'No institute account found with this email address' });
    }

    if (institute.status !== 'active') {
      return res.status(403).json({ message: 'Institute account is inactive' });
    }

    // Check credential expiry
    if (!institute.temp_expiry || new Date() > new Date(institute.temp_expiry)) {
      return res.status(403).json({ message: 'Your access has expired. Please contact MOLMI admin.' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + INSTITUTE_OTP_EXPIRY_MINUTES);

    // Save to DB
    await instituteDao.saveInstituteOtp(institute.id, hashedOtp, expiresAt);

    // Resolve the target email (the one they logged in with)
    const targetEmail = email.toLowerCase().trim();

    // Send Email
    const template = emailTemplates.instituteOtpLogin({
      otp,
      expiryMinutes: INSTITUTE_OTP_EXPIRY_MINUTES
    });

    await sendEmail({
      to: targetEmail,
      subject: template.subject,
      html: template.html,
      text: `Your login OTP is: ${otp}`
    });

    // Log activity
    await activityLogDao.createLog(
      institute.id,
      'OTP_REQUEST',
      `OTP requested for institute login via email`,
      req.ip || req.connection.remoteAddress
    );

    res.json({
      success: true,
      message: 'OTP has been sent to your email address.'
    });

  } catch (error) {
    console.error('Request OTP Error:', error);
    res.status(500).json({ message: 'Error sending OTP', error: error.message });
  }
};

const verifyInstituteOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return otpError(res, 400, 'Email and OTP are required', 'OTP_REQUIRED');
    }

    const institute = await instituteDao.getInstituteByEmail(email.toLowerCase().trim());

    if (!institute) {
      return otpError(res, 404, 'Institute not found', 'INSTITUTE_NOT_FOUND');
    }

    if (!institute.otp || !institute.otp_expires_at) {
      return otpError(res, 400, 'No active OTP found. Please request a new one.', 'OTP_NOT_FOUND');
    }

    // Check OTP expiry
    if (new Date() > new Date(institute.otp_expires_at)) {
      return otpError(res, 400, 'OTP has expired. Please request a new one.', 'OTP_EXPIRED');
    }

    // Verify OTP
    const isMatch = await bcrypt.compare(otp, institute.otp);
    if (!isMatch) {
      return otpError(res, 400, 'Invalid OTP code', 'INVALID_OTP');
    }

    // Clear OTP from DB
    await instituteDao.clearInstituteOtp(institute.id);

    // Determine intent from the institute's stored temp_username prefix
    const INSTITUTE_PREFIX_INTENTS = {
      'SUB-': 'institute_submit',
      'SHOR-': 'institute_shortlist',
      'INST-': 'institute_submit',
    };
    const tempUsername = (institute.temp_username || '').toUpperCase();
    const matchedPrefix = Object.keys(INSTITUTE_PREFIX_INTENTS).find(p => tempUsername.startsWith(p));
    const workflowIntent = matchedPrefix ? INSTITUTE_PREFIX_INTENTS[matchedPrefix] : 'institute_submit';

    // Generate Token
    const payload = {
      id: institute.id,
      role: ROLES.INSTITUTE,
      email: email.toLowerCase().trim(),
      first_name: institute.institute_name,
      last_name: '',
      intent: 'institute_drives',
      workflowIntent,
      redirectTo: INSTITUTE_RECRUITMENT_DRIVES_ROUTE,
      instituteId: institute.id,
      temp_expiry: institute.temp_expiry
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRE,
    });

    // Log success
    await activityLogDao.createLog(
      institute.id,
      'LOGIN',
      `Institute logged in via OTP (email: ${email})`,
      req.ip || req.connection.remoteAddress
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: institute.id,
        role: ROLES.INSTITUTE,
        first_name: institute.institute_name,
        last_name: '',
        email: email.toLowerCase().trim(),
        instituteId: institute.id,
        intent: 'institute_drives',
        workflowIntent,
        redirectTo: INSTITUTE_RECRUITMENT_DRIVES_ROUTE,
        temp_expiry: institute.temp_expiry
      }
    });

  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ message: 'Login error', error: error.message });
  }
};

module.exports = {
  requestInstituteOtp,
  verifyInstituteOtp,
};
