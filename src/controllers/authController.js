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
} = require('../utils/validationUtils');

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
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await UserDao.findUserByEmail(email);
    if (!user) {
      return res
        .status(404)
        .json({ message: 'This email address does not exist.' });
    }

    const resetLink = `${FRONTEND_URL}/reset-password?id=${user.id}`;
    const template = emailTemplates.forgotPassword({ resetLink });

    // Only attempt to send email if SMTP is configured, else just log it for dev
    if (process.env.SMTP_USER) {
      await sendEmail({
        to: email,
        subject: template.subject,
        html: template.html,
        text: 'Reset Password',
      });
    } else {
      console.log(`[DEV] Forgot Password Link for ${email}: ${resetLink}`);
    }

    // Log activity
    await activityLogDao.createLog(
      user.id,
      'PASSWORD_RESET_REQUEST',
      `User requested password reset`,
      req.ip || req.connection.remoteAddress,
    );

    res.json({ message: 'A password reset link has been sent to your email.' });
  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { userId, password, confirm_password } = req.body;

    if (!userId || !password || !confirm_password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password !== confirm_password) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    if (!isValidPasswordLength(password)) {
      return res.status(400).json({ message: PASSWORD_LENGTH_MESSAGE });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const updated = await UserDao.updateUserPassword(userId, hashedPassword);

    if (updated) {
      // Get user info for email and logging
      const user = await UserDao.findUserById(userId);

      // Optionally send a confirmation email
      if (user && process.env.SMTP_USER) {
        const template = emailTemplates.resetPasswordSuccess();
        await sendEmail({
          to: user.email,
          subject: template.subject,
          html: template.html,
          text: 'Password Reset Successful',
        });
      }

      // Log activity (reuse the user variable)
      if (user) {
        await activityLogDao.createLog(
          userId,
          'PASSWORD_RESET',
          `User reset their password`,
          req.ip || req.connection.remoteAddress,
        );
      }

      res.json({ message: 'Your password has been successfully updated.' });
    } else {
      res
        .status(400)
        .json({ message: 'Failed to update password. User not found.' });
    }
  } catch (error) {
    console.error('Reset Password Error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  login,
  forgotPassword,
  resetPassword,
};
