const instituteDao = require('../dao/instituteDao');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const activityLogDao = require('../dao/activityLogDao');
const { sendEmail, emailTemplates } = require('../services/emailService');
const jwt = require('jsonwebtoken');

const cadetDao = require('../dao/cadetDao');

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

const submitInstituteExcel = async (req, res) => {
  try {
    const { token } = req.body;
    const file = req.file;

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    if (!file) {
      return res.status(400).json({ message: 'Excel file is required' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (decoded.type !== 'excel_submission') {
        return res.status(401).json({ message: 'Invalid token type' });
      }

      const instituteId = decoded.instituteId;
      const adminYear = decoded.adminYear;
      const institute = await instituteDao.getInstituteById(instituteId);

      if (!institute) {
        return res.status(404).json({ message: 'Institute not found' });
      }

      // Generate filename for DB record
      const timestamp = Date.now();
      const filename = `${instituteId}_${timestamp}_${file.originalname}`;

      // Store in DB
      await instituteDao.createSubmission(
        instituteId,
        filename,
        file.originalname,
        file.buffer,
        adminYear,
      );

      res.json({
        success: true,
        message: 'File submitted successfully',
        filename,
      });
    } catch (err) {
      return res
        .status(401)
        .json({ message: 'Invalid or expired token', error: err.message });
    }
  } catch (error) {
    console.error('Submit Excel Error:', error);
    res
      .status(500)
      .json({ message: 'Error submitting file', error: error.message });
  }
};

const getAllSubmissions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || 'all';
    const search = req.query.search || '';

    const offset = (page - 1) * limit;

    const { data, total } = await instituteDao.getAllSubmissions(
      limit,
      offset,
      status,
      search,
    );

    res.json({
      data,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Get All Submissions Error:', error);
    res
      .status(500)
      .json({ message: 'Error fetching submissions', error: error.message });
  }
};

const {
  parseExcelFile,
  findHeaderRow,
  mapRowToCadetData,
} = require('../services/excelImportService');

// Helper function for import logic
const processImport = async (id, userId, clientIp) => {
  const submission = await instituteDao.getSubmissionById(id);
  if (!submission) throw new Error('Submission not found');
  if (submission.status === 'imported')
    throw new Error('Submission already imported');

  const submissionFile = await instituteDao.getSubmissionFile(id);
  if (!submissionFile || !submissionFile.file_data)
    throw new Error('File data not found');

  const rawData = parseExcelFile(submissionFile.file_data);
  const headerKeywords = [
    'name',
    'email',
    'phone',
    'contact',
    'dob',
    'gender',
    'batch',
    's.no',
    'sr.no',
    'roll no',
    'indos',
  ];
  const headerInfo = findHeaderRow(rawData, headerKeywords);
  if (!headerInfo)
    throw new Error('Could not identify header row in Excel file');

  const { rowIndex: headerRowIndex, headers } = headerInfo;
  let successCount = 0;
  let failedCount = 0;

  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const rowData = rawData[i];
    if (!rowData || rowData.length === 0) continue;
    try {
      const cadetData = mapRowToCadetData(rowData, headers, submission);
      if (cadetData.name) {
        await cadetDao.createCadet(cadetData);
        successCount++;
      } else {
        failedCount++;
      }
    } catch (err) {
      console.error('Error importing row:', i, err);
      failedCount++;
    }
  }

  await instituteDao.updateSubmissionStatus(id, 'imported');

  if (userId) {
    await activityLogDao.createLog(
      userId,
      'IMPORT_SUBMISSION',
      `Imported ${successCount} cadets from submission ${id}`,
      clientIp,
    );
  }
  return { success: successCount, failed: failedCount };
};

const importSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const stats = await processImport(
      id,
      req.user?.id,
      req.ip || req.connection.remoteAddress,
    );
    res.json({
      success: true,
      message: 'Import completed',
      stats: {
        success: stats.success,
        failed: stats.failed,
        total: stats.success + stats.failed,
      },
    });
  } catch (error) {
    if (error.message === 'Submission not found')
      return res.status(404).json({ message: error.message });
    if (error.message === 'Submission already imported')
      return res.status(400).json({ message: error.message });
    console.error('Import Submission Error:', error);
    res
      .status(500)
      .json({ message: 'Error importing submission', error: error.message });
  }
};

const deleteSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await instituteDao.deleteSubmission(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'DELETE_SUBMISSION',
        `Deleted submission ${id}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({ message: 'Submission deleted successfully' });
  } catch (error) {
    console.error('Delete Submission Error:', error);
    res
      .status(500)
      .json({ message: 'Error deleting submission', error: error.message });
  }
};

const bulkDeleteSubmissions = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'IDs array is required' });
    }

    const deletedCount = await instituteDao.deleteSubmissions(ids);

    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'BULK_DELETE_SUBMISSION',
        `Deleted ${deletedCount} submissions`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      message: `${deletedCount} submissions deleted successfully`,
      count: deletedCount,
    });
  } catch (error) {
    console.error('Bulk Delete Error:', error);
    res
      .status(500)
      .json({ message: 'Error deleting submissions', error: error.message });
  }
};

const bulkImportSubmissions = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'IDs array is required' });
    }

    const results = [];
    for (const id of ids) {
      try {
        const stats = await processImport(
          id,
          req.user?.id,
          req.ip || req.connection.remoteAddress,
        );
        results.push({ id, status: 'success', stats });
      } catch (error) {
        results.push({ id, status: 'failed', reason: error.message });
      }
    }

    res.json({ message: 'Bulk import processed', results });
  } catch (error) {
    console.error('Bulk Import Error:', error);
    res
      .status(500)
      .json({ message: 'Error processing bulk import', error: error.message });
  }
};

const downloadSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const submission = await instituteDao.getSubmissionFile(id);

    if (!submission || !submission.file_data) {
      return res.status(404).json({ message: 'File not found' });
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${submission.original_name}"`,
    );
    res.send(submission.file_data);
  } catch (error) {
    console.error('Download Submission Error:', error);
    res
      .status(500)
      .json({ message: 'Error downloading file', error: error.message });
  }
};

module.exports = {
  sendInstituteEmail,
  verifyInstituteToken,
  submitInstituteExcel,
  getAllSubmissions,
  importSubmission,
  downloadSubmission,
  deleteSubmission,
  bulkDeleteSubmissions,
  bulkImportSubmissions,
  loginInstitute,
};
