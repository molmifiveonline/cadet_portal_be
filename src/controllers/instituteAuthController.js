const instituteDao = require('../dao/instituteDao');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const activityLogDao = require('../dao/activityLogDao');
const { sendEmail, emailTemplates } = require('../services/emailService');
const jwt = require('jsonwebtoken');
const {
  JWT_SECRET,
  INSTITUTE_CREDENTIAL_EXPIRY_DAYS,
  DRIVE_STATUS,
} = require('../config/constants');
const recruitmentDriveDao = require('../dao/recruitmentDriveDao');
const shortlistService = require('../services/shortlistService');

const normalizeCourseType = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'deck') return 'Deck';
  if (normalized === 'engine') return 'Engine';
  return null;
};

const sendInstituteEmail = async (req, res) => {
  try {
    const { instituteIds, subject, description, batch_year, course_type } =
      req.body;
    const file = req.file;
    const resolvedCourseType = normalizeCourseType(course_type);

    if (!instituteIds || !subject || !description) {
      return res.status(400).json({
        message: 'Institute IDs, subject, and description are required',
      });
    }

    if (!file) {
      return res.status(400).json({ message: 'Excel format file is required' });
    }

    if (!resolvedCourseType) {
      return res.status(400).json({
        message: 'Course type is required and must be Deck or Engine',
      });
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
    const expiryDays = INSTITUTE_CREDENTIAL_EXPIRY_DAYS;
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

      if (institute.status !== 'active') {
        results.push({ id, status: 'failed', reason: 'Institute is inactive' });
        continue;
      }

      // Generate Temp Credentials
      const tempUsername = `SUB-${Math.floor(100000 + Math.random() * 900000)}`;
      const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase();

      // Store in DB
      await instituteDao.updateInstituteCredentials(
        id,
        tempUsername,
        tempPassword,
        mysqlExpiryDate,
        batch_year || new Date().getFullYear(),
        resolvedCourseType,
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
        batch_year: batch_year || new Date().getFullYear(),
        course_type: resolvedCourseType,
      });

      // Determine target Email
      let targetEmail = '';
      if (typeof institute.contact_emails === 'string') {
        try {
          institute.contact_emails = JSON.parse(institute.contact_emails);
        } catch (e) {}
      }
      if (institute.contact_emails && Array.isArray(institute.contact_emails)) {
        const defaultContact =
          institute.contact_emails.find((c) => c.isDefault) ||
          institute.contact_emails[0];
        targetEmail = defaultContact ? defaultContact.email : '';
      }

      if (!targetEmail) {
        results.push({
          id,
          status: 'failed',
          reason: 'No contact email found',
        });
        continue;
      }

      // Send Email
      try {
        await sendEmail({
          to: targetEmail,
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
          email: targetEmail,
        });

        // Automatically update Recruitment Drive status to 'Requested' if matching drive exists
        try {
          const drive = await recruitmentDriveDao.getDriveByInstituteYearCourseType(
            id,
            batch_year || new Date().getFullYear(),
            resolvedCourseType
          );
          if (drive && drive.status === DRIVE_STATUS.DRAFT) {
            await recruitmentDriveDao.updateRecruitmentDrive(drive.id, {
              status: DRIVE_STATUS.REQUESTED
            });
          }
        } catch (driveErr) {
          console.error('Error updating drive status after sending email:', driveErr);
        }
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

const sendShortlistEmail = async (req, res) => {
  try {
    const { instituteIds, subject } = req.body;

    if (!instituteIds) {
      return res.status(400).json({
        message: 'Institute IDs are required',
      });
    }

    // Parse instituteIds
    let ids = [];
    if (Array.isArray(instituteIds)) {
      ids = instituteIds;
    } else if (typeof instituteIds === 'string') {
      if (instituteIds.trim().startsWith('[')) {
        ids = JSON.parse(instituteIds);
      } else {
        ids = instituteIds.split(',').map((id) => id.trim());
      }
    }

    // Get shortlist count per institute to include in emails
    const shortlistCounts =
      await shortlistService.getShortlistCountByInstitute();
    const countMap = {};
    shortlistCounts.forEach((item) => {
      countMap[item.institute_id] = item.count;
    });

    const results = [];
    const expiryDays = INSTITUTE_CREDENTIAL_EXPIRY_DAYS;
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

      if (institute.status !== 'active') {
        results.push({ id, status: 'failed', reason: 'Institute is inactive' });
        continue;
      }

      const cadetCount = countMap[id] || 0;
      if (cadetCount === 0) {
        results.push({
          id,
          status: 'skipped',
          reason: 'No shortlisted cadets',
        });
        continue;
      }

      // Generate SHOR- prefix credentials
      const tempUsername = `SHOR-${Math.floor(100000 + Math.random() * 900000)}`;
      const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase();

      // Store in DB
      await instituteDao.updateInstituteCredentials(
        id,
        tempUsername,
        tempPassword,
        mysqlExpiryDate,
        new Date().getFullYear(),
      );

      // Generate Link
      const link = `${process.env.FRONTEND_URL}/institute/shortlisted-cadets`;

      // Prepare Email
      const emailContent = emailTemplates.instituteShortlistView({
        instituteName: institute.institute_name,
        subject,
        cadetCount,
        link,
        expiryDate: expiryDateString,
        tempUsername,
        tempPassword,
      });

      // Determine target Email
      let targetEmail = '';
      if (typeof institute.contact_emails === 'string') {
        try {
          institute.contact_emails = JSON.parse(institute.contact_emails);
        } catch (e) {}
      }
      if (institute.contact_emails && Array.isArray(institute.contact_emails)) {
        const defaultContact =
          institute.contact_emails.find((c) => c.isDefault) ||
          institute.contact_emails[0];
        targetEmail = defaultContact ? defaultContact.email : '';
      }

      if (!targetEmail) {
        results.push({
          id,
          status: 'failed',
          reason: 'No contact email found',
        });
        continue;
      }

      // Send Email
      try {
        await sendEmail({
          to: targetEmail,
          subject: emailContent.subject,
          html: emailContent.html,
        });
        results.push({
          id,
          status: 'success',
          email: targetEmail,
          cadetCount,
        });
      } catch (err) {
        console.error(
          `Failed to send shortlist email to institute ${id}:`,
          err,
        );
        results.push({ id, status: 'failed', reason: err.message });
      }
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'SEND_SHORTLIST_EMAIL',
        `Sent shortlist view email to ${results.filter((r) => r.status === 'success').length} institutes`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      message: 'Shortlist email processing completed',
      results,
    });
  } catch (error) {
    console.error('Send Shortlist Email Error:', error);
    res.status(500).json({
      message: 'Error sending shortlist emails',
      error: error.message,
    });
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

    if (institute.status !== 'active') {
      return res.status(403).json({ message: 'Institute account is inactive' });
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
        exp:
          Math.floor(Date.now() / 1000) +
          INSTITUTE_CREDENTIAL_EXPIRY_DAYS * 24 * 60 * 60,
      },
      JWT_SECRET,
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
      const decoded = jwt.verify(token, JWT_SECRET);

      if (decoded.type !== 'excel_submission') {
        return res.status(401).json({ message: 'Invalid token type' });
      }

      const instituteId = decoded.instituteId;
      const institute = await instituteDao.getInstituteById(instituteId);

      if (!institute) {
        return res.status(404).json({ message: 'Institute not found' });
      }

      if (institute.status !== 'active') {
        return res
          .status(403)
          .json({ message: 'Institute account is inactive' });
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
  sendShortlistEmail,
  loginInstitute,
  verifyInstituteToken,
};
