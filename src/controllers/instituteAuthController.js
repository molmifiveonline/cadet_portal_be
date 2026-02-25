const instituteDao = require('../dao/instituteDao');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const activityLogDao = require('../dao/activityLogDao');
const { sendEmail, emailTemplates } = require('../services/emailService');
const jwt = require('jsonwebtoken');

const sendInstituteEmail = async (req, res) => {
  try {
    const { instituteIds, subject, description, adminYear } = req.body;
    const file = req.file;

    if (!instituteIds || !subject || !description) {
      return res.status(400).json({
        message: 'Institute IDs, subject, and description are required',
      });
    }

    if (!file) {
      return res.status(400).json({ message: 'Excel format file is required' });
    }

    // Parse instituteIds if it's a string (from FormData)
    let ids = [];
    try {
      // Check if instituteIds is already an array or needs parsing
      if (Array.isArray(instituteIds)) {
        ids = instituteIds;
      } else if (typeof instituteIds === 'string') {
        // Try parsing as JSON first (in case of stringified array)
        if (instituteIds.trim().startsWith('[')) {
          ids = JSON.parse(instituteIds);
        } else {
          // Treat as comma-separated or single ID
          ids = instituteIds.split(',').map((id) => id.trim());
        }
      }
    } catch (e) {
      // Fallback
      ids = [instituteIds];
    }

    const results = [];
    const expiryDays = 7;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);
    const expiryDateString = expiryDate.toLocaleDateString('en-GB');

    // Format for MySQL timestamp
    const mysqlExpiryDate = expiryDate
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    for (const id of ids) {
      const institute = await instituteDao.getInstituteById(id);
      if (!institute) {
        results.push({ id, status: 'failed', reason: 'Institute not found' });
        continue;
      }

      // Generate Temp Credentials
      const tempUsername = `INST-${Math.floor(100000 + Math.random() * 900000)}`;
      const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase();

      // Store in DB
      await instituteDao.updateInstituteCredentials(
        id,
        tempUsername,
        tempPassword,
        mysqlExpiryDate,
        adminYear || new Date().getFullYear(),
      );

      // Generate Link (No token needed now)
      const link = `${process.env.FRONTEND_URL}/institute/submit-excel`;

      // Prepare Email
      const emailContent = emailTemplates.instituteExcelSubmission({
        instituteName: institute.institute_name,
        subject,
        description,
        link,
        expiryDate: expiryDateString,
        tempUsername,
        tempPassword,
        adminYear: adminYear || new Date().getFullYear(),
      });

      // Send Email
      try {
        await sendEmail({
          to: institute.institute_email, // Auto-filled institute email
          subject: emailContent.subject,
          html: emailContent.html,
          attachments: [
            {
              filename: file.originalname,
              content: file.buffer,
            },
          ],
        });
        results.push({
          id,
          status: 'success',
          email: institute.institute_email,
        });
      } catch (err) {
        console.error(`Failed to send email to institute ${id}:`, err);
        results.push({ id, status: 'failed', reason: err.message });
      }
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'SEND_INSTITUTE_EMAIL',
        `Sent excel submission email to ${results.filter((r) => r.status === 'success').length} institutes`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      message: 'Email processing completed',
      results,
    });
  } catch (error) {
    console.error('Send Institute Email Error:', error);
    res
      .status(500)
      .json({ message: 'Error sending emails', error: error.message });
  }
};

const loginInstitute = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: 'Username and password are required' });
    }

    const institute = await instituteDao.getInstituteByTempUsername(username);

    if (!institute) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check expiry
    if (new Date() > new Date(institute.temp_expiry)) {
      return res.status(401).json({ message: 'Credentials have expired' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, institute.temp_password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate Token
    const token = jwt.sign(
      {
        instituteId: institute.id,
        adminYear: institute.batch_year,
        type: 'excel_submission',
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
      },
      process.env.JWT_SECRET || 'fallback_secret',
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      instituteName: institute.institute_name,
    });
  } catch (error) {
    console.error('Institute Login Error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const verifyInstituteToken = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (decoded.type !== 'excel_submission') {
        return res.status(401).json({ message: 'Invalid token type' });
      }

      const instituteId = decoded.instituteId;
      const institute = await instituteDao.getInstituteById(instituteId);

      if (!institute) {
        return res.status(404).json({ message: 'Institute not found' });
      }

      res.json({
        success: true,
        instituteName: institute.institute_name,
        valid: true,
      });
    } catch (err) {
      return res
        .status(401)
        .json({ message: 'Invalid or expired token', error: err.message });
    }
  } catch (error) {
    console.error('Verify Token Error:', error);
    res
      .status(500)
      .json({ message: 'Error verifying token', error: error.message });
  }
};

module.exports = {
  sendInstituteEmail,
  loginInstitute,
  verifyInstituteToken,
};
