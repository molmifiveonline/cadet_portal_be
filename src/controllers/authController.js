const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const UserDao = require('../dao/userDao');
const { sendEmail, emailTemplates } = require('../services/emailService');
const activityLogDao = require('../dao/activityLogDao');
const {
  JWT_SECRET,
  JWT_EXPIRE,
  ROLES,
  BCRYPT_SALT_ROUNDS,
  FRONTEND_URL,
} = require('../config/constants');
const instituteDao = require('../dao/instituteDao');
const {
  PASSWORD_LENGTH_MESSAGE,
  isValidPasswordLength,
  getEmailValidationMessage,
} = require('../utils/validationUtils');
const {
  PASSWORD_RESET_EXPIRY_MINUTES,
  INVALID_RESET_LINK_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_RESET_LIMIT_MESSAGE,
  createPasswordResetToken,
  isValidPasswordResetToken,
  hashPasswordResetToken,
} = require('../services/passwordResetService');

const rejectResetLink = (res) =>
  res.status(400).json({
    message: INVALID_RESET_LINK_MESSAGE,
    code: 'INVALID_RESET_TOKEN',
  });

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: 'Email and password are required' });
    }

    let user = null;
    let roleName = ROLES.CADET;
    let instituteId = null;

    // Configuration for Institute temp login prefixes and their intents
    const INSTITUTE_PREFIX_INTENTS = {
      'SUB-': 'institute_submit',
      'SHOR-': 'institute_shortlist',
      'INST-': 'institute_submit', // Legacy support
    };

    // Check if it's an Institute login (Using temp username)
    const upperEmail = email.toUpperCase();

    // Check if the username starts with any of the defined prefixes
    const matchedPrefix = Object.keys(INSTITUTE_PREFIX_INTENTS).find((prefix) =>
      upperEmail.startsWith(prefix),
    );

    const isInstituteLogin = !email.includes('@') && !!matchedPrefix;

    if (isInstituteLogin) {
      // Return error for institutes to use OTP flow
      return res.status(400).json({ 
        message: 'Institute login has been upgraded to OTP-based security. Please use the OTP login flow.',
        isInstitute: true
      });
    }

    // Regular Admin user login
    user = await UserDao.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (
      user.status !== undefined &&
      user.status !== 1 &&
      user.status !== 'active'
    ) {
      return res.status(403).json({ message: 'Account is inactive' });
    }

    roleName = user.role || ROLES.CADET;

    const payload = {
      id: user.id,
      role: roleName,
      email: user.email,
      first_name: user.first_name || '',
      last_name: user.last_name || '',
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRE,
    });

    // Log activity
    await activityLogDao.createLog(
      user.id,
      'LOGIN',
      `User logged in successfully`,
      req.ip || req.connection.remoteAddress,
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        role: roleName,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    res
      .status(500)
      .json({ message: 'Server error during login', error: error.message });
  }
};

const forgotPassword = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { email } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }
    const emailMessage = getEmailValidationMessage(email.trim());
    if (emailMessage) return res.status(400).json({ message: emailMessage });

    const user = await UserDao.findUserByEmail(email.trim());
    if (!user) {
      return res.json({ message: PASSWORD_RESET_REQUEST_MESSAGE });
    }

    const token = createPasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);
    const result = await UserDao.issuePasswordResetToken(user.id, tokenHash);
    if (result.limitReached) {
      res.set('Retry-After', String(result.retryAfterSeconds));
      return res.status(429).json({
        message: PASSWORD_RESET_LIMIT_MESSAGE,
        code: 'PASSWORD_RESET_LIMIT_REACHED',
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    if (!result.issued) return res.json({ message: PASSWORD_RESET_REQUEST_MESSAGE });

    const resetLink = `${FRONTEND_URL}/reset-password?token=${token}`;
    const template = emailTemplates.forgotPassword({
      resetLink,
      expiryMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
    });

    try {
      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: `Reset your MOLMI password: ${resetLink}\nThis link expires in ${PASSWORD_RESET_EXPIRY_MINUTES} minutes and can be used only once.`,
      });
    } catch (error) {
      await UserDao.revokePasswordResetToken(user.id, tokenHash);
      throw error;
    }

    // Log activity
    await activityLogDao.createLog(
      user.id,
      'PASSWORD_RESET_REQUEST',
      `User requested password reset`,
      req.ip || req.connection?.remoteAddress,
    );

    res.json({ message: PASSWORD_RESET_REQUEST_MESSAGE });
  } catch (error) {
    console.error('Forgot Password Error:', error.code || error.name);
    res.status(500).json({ message: 'Unable to send a reset email. Please try again later.' });
  }
};

const validateResetToken = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { token } = req.body || {};
    if (!isValidPasswordResetToken(token)) return rejectResetLink(res);
    const user = await UserDao.findUserByPasswordResetToken(hashPasswordResetToken(token));
    if (!user) return rejectResetLink(res);
    return res.json({ message: 'Reset link is valid.' });
  } catch (error) {
    console.error('Reset Link Validation Error:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to verify this reset link. Please try again.' });
  }
};

const resetPassword = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { token, password, confirm_password } = req.body || {};
    if (!isValidPasswordResetToken(token)) return rejectResetLink(res);

    if (!password || !confirm_password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password !== confirm_password) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    if (!isValidPasswordLength(password)) {
      return res.status(400).json({ message: PASSWORD_LENGTH_MESSAGE });
    }

    const tokenHash = hashPasswordResetToken(token);
    const user = await UserDao.findUserByPasswordResetToken(tokenHash);
    if (!user) return rejectResetLink(res);
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const updated = await UserDao.consumePasswordResetToken(user.id, tokenHash, hashedPassword);
    if (!updated) return rejectResetLink(res);

    await activityLogDao.createLog(
      user.id,
      'PASSWORD_RESET',
      'User reset their password',
      req.ip || req.connection?.remoteAddress,
    );

    // A notification failure must not report failure after the password changed.
    try {
      const template = emailTemplates.resetPasswordSuccess();
      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: 'Your MOLMI password has been successfully updated.',
      });
    } catch (error) {
      console.error('Password Reset Confirmation Email Error:', error.code || error.name);
    }

    return res.json({ message: 'Your password has been successfully updated.' });
  } catch (error) {
    console.error('Reset Password Error:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to reset your password. Please try again.' });
  }
};

module.exports = {
  login,
  forgotPassword,
  resetPassword,
  validateResetToken,
};
