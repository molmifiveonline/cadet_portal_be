const instituteDao = require('../dao/instituteDao');
const activityLogDao = require('../dao/activityLogDao');
const { sendEmail, emailTemplates } = require('../utils/emailService');
const jwt = require('jsonwebtoken');

const cadetDao = require('../dao/cadetDao');

const sendInstituteEmail = async (req, res) => {
  try {
    const { instituteIds, subject, description } = req.body;
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

    for (const id of ids) {
      const institute = await instituteDao.getInstituteById(id);
      if (!institute) {
        results.push({ id, status: 'failed', reason: 'Institute not found' });
        continue;
      }

      // Generate Token
      const token = jwt.sign(
        {
          instituteId: id,
          type: 'excel_submission',
          exp: Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60,
        },
        process.env.JWT_SECRET,
      );

      // Generate Link
      const link = `${process.env.FRONTEND_URL}/institute/submit-excel?token=${token}`;

      // Prepare Email
      const emailContent = emailTemplates.instituteExcelSubmission({
        instituteName: institute.institute_name,
        subject,
        description,
        link,
        expiryDate: expiryDateString,
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

    const offset = (page - 1) * limit;

    const { data, total } = await instituteDao.getAllSubmissions(
      limit,
      offset,
      status,
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

const importSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const submission = await instituteDao.getSubmissionById(id);

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (submission.status === 'imported') {
      return res.status(400).json({ message: 'Submission already imported' });
    }

    // Fetch File Data from DB
    const submissionFile = await instituteDao.getSubmissionFile(id);
    if (!submissionFile || !submissionFile.file_data) {
      return res.status(404).json({ message: 'File data not found' });
    }

    const rawData = parseExcelFile(submissionFile.file_data);

    // Potential header keywords to look for
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
    if (!headerInfo) {
      return res
        .status(400)
        .json({ message: 'Could not identify header row in Excel file' });
    }

    const { rowIndex: headerRowIndex, headers } = headerInfo;

    // Process Data starting from row after header
    let successCount = 0;
    let failedCount = 0;

    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
      const rowData = rawData[i];
      if (!rowData || rowData.length === 0) continue;

      try {
        const cadetData = mapRowToCadetData(rowData, headers, submission);

        // Minimal requirement: Name
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

    // Update Submission Status
    await instituteDao.updateSubmissionStatus(id, 'imported');

    // Log Activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'IMPORT_SUBMISSION',
        `Imported ${successCount} cadets from submission ${id}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      success: true,
      message: 'Import completed',
      stats: {
        success: successCount,
        failed: failedCount,
        total: successCount + failedCount,
      },
    });
  } catch (error) {
    console.error('Import Submission Error:', error);
    res
      .status(500)
      .json({ message: 'Error importing submission', error: error.message });
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
};
