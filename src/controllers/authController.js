const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const UserDao = require('../dao/userDao');
const db = require('../config/database');
const { sendEmail } = require('../utils/emailService');
const activityLogDao = require('../dao/activityLogDao');

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: 'Email and password are required' });
    }

    const user = await UserDao.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (
      user.status !== undefined &&
      user.status !== 1 &&
      user.status !== 'active'
    ) {
      return res.status(403).json({ message: 'Account is inactive' });
    }

    const roleName = user.role || 'Candidate';

    const token = jwt.sign(
      {
        id: user.id,
        role: roleName,
        email: user.email,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '1d' },
    );

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

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?id=${user.id}`;
    const subject = 'Reset Password Link';
    const html = `
      <div style="font-family: Arial, sans-serif;">
        <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
            <h2>Reset Password Link</h2>
        </div>
        <div style="padding: 20px;">
            <p>Hi,</p>
            <p>You requested to reset your password. Click the link below to reset it:</p>
            <p><a href="${resetLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
            <p>If you didn't request this, you can ignore this email.</p>
        </div>
        <div style="background-color: #f4f4f4; padding: 10px; text-align: center; font-size: 12px; color: #666;">
            &copy; ${new Date().getFullYear()} Molmi. All rights reserved.
        </div>
      </div>
    `;

    // Only attempt to send email if SMTP is configured, else just log it for dev
    if (process.env.SMTP_USER) {
      await sendEmail({ to: email, subject, html, text: 'Reset Password' });
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

    const hashedPassword = await bcrypt.hash(password, 10);
    const updated = await UserDao.updateUserPassword(userId, hashedPassword);

    if (updated) {
      // Get user info for email and logging
      const user = await UserDao.findUserById(userId);

      // Optionally send a confirmation email
      if (user && process.env.SMTP_USER) {
        const subject = 'Password Reset Successful';
        const html = `<p>Hi,</p><p>Your password has been successfully updated.</p>`;
        await sendEmail({
          to: user.email,
          subject,
          html,
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
