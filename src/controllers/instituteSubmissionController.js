const instituteDao = require('../dao/instituteDao');
const activityLogDao = require('../dao/activityLogDao');
const cadetDao = require('../dao/cadetDao');
const {
  DEFAULT_PAGE_SIZE,
  EXCEL_HEADER_KEYWORDS,
  SUBMISSION_STATUS,
  DRIVE_STATUS,
} = require('../config/constants');
const recruitmentDriveDao = require('../dao/recruitmentDriveDao');
const { logAndSendEmail, emailTemplates } = require('../services/recruitmentCommunicationService');
const { COMMUNICATION_TYPES } = require('../services/recruitmentWorkflowService');
const notificationService = require('../services/notificationService');
const {
  parseExcelFile,
  findHeaderRow,
  mapRowToCadetData,
  isRowEmpty,
  validateExcelPhoneFields,
} = require('../services/excelImportService');

const normalizeCourseType = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'deck') return 'Deck';
  if (normalized === 'engine') return 'Engine';
  return null;
};

const INSTITUTE_UPLOAD_CLOSED_STATUSES = new Set([
  DRIVE_STATUS.RECEIVED,
  DRIVE_STATUS.SUBMITTED,
  DRIVE_STATUS.SHORTLISTED,
  DRIVE_STATUS.ASSESSMENT_COMPLETED,
  DRIVE_STATUS.INTERVIEW_COMPLETED,
  DRIVE_STATUS.MEDICAL_COMPLETED,
  DRIVE_STATUS.CLOSED,
]);

const submitInstituteExcel = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'Excel file is required' });
    }

    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized. Please log in.' });
    }

    const isAdmin =
      req.user.role === 'role-super-admin' || req.user.role === 'SuperAdmin';
    let instituteId = req.user.instituteId;

    if (isAdmin) {
      if (!req.body.instituteId) {
        return res
          .status(400)
          .json({ message: 'Institute ID is required for Admins.' });
      }
      instituteId = req.body.instituteId;
    } else if (!instituteId) {
      return res
        .status(401)
        .json({ message: 'Unauthorized. Institute account required.' });
    }

    try {
      const institute = await instituteDao.getInstituteById(instituteId);
      const submissionRemarks = req.body.remarks || null;

      if (!institute) {
        return res.status(404).json({ message: 'Institute not found' });
      }

      const requestedDriveId = req.body.drive_id || req.body.driveId || null;
      let drive = null;

      if (requestedDriveId) {
        drive = await recruitmentDriveDao.getRecruitmentDriveById(requestedDriveId);

        if (!drive) {
          return res.status(404).json({ message: 'Recruitment drive not found' });
        }

        if (drive.institute_id !== instituteId) {
          return res.status(400).json({
            message: 'Recruitment drive does not belong to the selected institute.',
          });
        }
      }

      const batch_year = req.body.batch_year || drive?.year || institute.batch_year;
      const requestedCourseType = req.body.course_type || drive?.course_type || institute.submission_course_type;
      const course_type = normalizeCourseType(requestedCourseType);

      if (!batch_year) {
        return res.status(400).json({
          message:
            'Batch year is missing for this submission. Please resend request email.',
        });
      }

      if (!course_type) {
        return res.status(400).json({
          message:
            'Course type is missing or invalid for this submission. Please resend request email with Deck/Engine.',
        });
      }

      const { rawData } = parseExcelFile(file.buffer);
      const headerInfo = findHeaderRow(rawData, EXCEL_HEADER_KEYWORDS);
      if (!headerInfo) {
        return res
          .status(400)
          .json({ message: 'Could not identify header row in Excel file' });
      }

      const phoneValidationMessage = validateExcelPhoneFields(
        rawData,
        headerInfo.headers,
        headerInfo.rowIndex + 1,
      );
      if (phoneValidationMessage) {
        return res.status(400).json({ message: phoneValidationMessage });
      }

      if (
        drive &&
        (String(drive.year) !== String(batch_year) ||
          normalizeCourseType(drive.course_type) !== course_type)
      ) {
        return res.status(400).json({
          message:
            'Recruitment drive, batch year, and course type do not match.',
        });
      }

      if (!drive) {
        drive = await recruitmentDriveDao.getDriveByInstituteYearCourseType(
          instituteId,
          batch_year,
          course_type,
        );
      }

      if (!isAdmin) {
        const activeSubmission =
          await instituteDao.getActiveSubmissionForContext(
            instituteId,
            batch_year,
            course_type,
            drive?.id || null,
          );

        if (
          activeSubmission ||
          (drive && INSTITUTE_UPLOAD_CLOSED_STATUSES.has(drive.status))
        ) {
          return res.status(409).json({
            message:
              'Cadet data has already been submitted for this drive. Further uploads are disabled.',
          });
        }
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
        batch_year,
        course_type,
        submissionRemarks,
        drive?.id || null,
      );

      // Notify MOLMI team after institute submission
      const molmiTeamEmail =
        process.env.MOLMI_TEAM_EMAILS ||
        process.env.MOLMI_TEAM_EMAIL ||
        process.env.EMAIL_FROM_ADDRESS ||
        process.env.EMAIL_USER;

      if (molmiTeamEmail) {
        try {
          await logAndSendEmail({
            to: molmiTeamEmail,
            template: emailTemplates.instituteSubmissionConfirmation,
            templateData: {
              instituteName: institute.institute_name,
              driveName: drive?.drive_name,
              batchYear: batch_year,
              courseType: course_type,
              remarks: submissionRemarks,
            },
            drive_id: drive?.id || null,
            institute_id: instituteId,
            communication_type: COMMUNICATION_TYPES.INSTITUTE_SUBMISSION,
            remarks: submissionRemarks,
            sent_by: req.user?.id || null,
          });
        } catch (emailErr) {
          console.error('Error sending institute submission email notification:', emailErr);
        }
      }

      // Notification for admins
      await notificationService.notifyAdmins(
        'New Cadet Data Uploaded',
        `${institute.institute_name} has uploaded cadet data for ${course_type} (${batch_year}).`,
        drive ? `/drives/${drive.id}` : '/institutes/submissions'
      );

      // Log activity
      if (req.user && req.user.id) {
        await activityLogDao.createLog(
          req.user.id,
          'SUBMIT_EXCEL',
          `Submitted excel file: ${file.originalname}`,
          req.ip || req.connection.remoteAddress
        );
      }

      // Automatically update Recruitment Drive status to 'Received' if matching drive exists
      try {
        if (drive && (drive.status === DRIVE_STATUS.REQUESTED || drive.status === DRIVE_STATUS.DRAFT)) {
          await recruitmentDriveDao.updateRecruitmentDrive(drive.id, {
            status: DRIVE_STATUS.RECEIVED
          });
        }
      } catch (driveErr) {
        console.error('Error updating drive status after submission:', driveErr);
        // Don't fail the submission if drive status update fails
      }

      res.json({
        success: true,
        message: 'File submitted successfully',
        filename,
        drive_id: drive?.id || null,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: 'Error processing submission', error: err.message });
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
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const status = req.query.status || 'all';
    const search = req.query.search || '';
    const instituteId = req.query.instituteId || '';
    const batchYear = req.query.batchYear || '';
    const courseType = normalizeCourseType(req.query.courseType) || '';
    const driveId = req.query.driveId || req.query.drive_id || '';

    const offset = (page - 1) * limit;

    const { data, total } = await instituteDao.getAllSubmissions(
      limit,
      offset,
      status,
      search,
      instituteId,
      batchYear,
      courseType,
      driveId,
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

// Helper function to parse submission data without importing
const parseSubmissionData = async (submissionId, driveId = null) => {
  const submission = await instituteDao.getSubmissionById(submissionId);
  if (!submission) throw new Error('Submission not found');

  const submissionFile = await instituteDao.getSubmissionFile(submissionId);
  if (!submissionFile || !submissionFile.file_data)
    throw new Error('File data not found');

  const { rawData } = parseExcelFile(submissionFile.file_data);
  const headerKeywords = EXCEL_HEADER_KEYWORDS;
  const headerInfo = findHeaderRow(rawData, headerKeywords);
  if (!headerInfo)
    throw new Error('Could not identify header row in Excel file');

  const { rowIndex: headerRowIndex, headers } = headerInfo;
  const phoneValidationMessage = validateExcelPhoneFields(
    rawData,
    headers,
    headerRowIndex + 1,
  );
  if (phoneValidationMessage) {
    const error = new Error(phoneValidationMessage);
    error.statusCode = 400;
    throw error;
  }

  const cadets = [];

  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const rowData = rawData[i];
    if (isRowEmpty(rowData)) continue;
    try {
      const cadetData = mapRowToCadetData(rowData, headers, submission);
      const resolvedDriveId = driveId || submission.drive_id || null;
      if (resolvedDriveId) cadetData.drive_id = resolvedDriveId;
      cadets.push(cadetData);
    } catch (err) {
      console.error('Error parsing row:', i, err);
    }
  }
  return { cadets, submission };
};

// Helper function for import logic
const processImport = async (id, userId, clientIp, driveId = null) => {
  const { cadets, submission } = await parseSubmissionData(id, driveId);
  const resolvedDriveId = driveId || submission?.drive_id || null;
  const drive = resolvedDriveId
    ? await recruitmentDriveDao.getRecruitmentDriveById(resolvedDriveId)
    : null;
  
  if (submission.status === SUBMISSION_STATUS.IMPORTED)
    throw new Error('Submission already imported');

  let successCount = 0;
  let failedCount = 0;

  for (const cadetData of cadets) {
    try {
      if (cadetData.name_as_in_indos_cert) {
        await cadetDao.createCadet(cadetData);
        successCount++;
      } else {
        failedCount++;
      }
    } catch (err) {
      console.error('Error importing cadet:', err);
      failedCount++;
    }
  }

  await instituteDao.updateSubmissionStatus(id, SUBMISSION_STATUS.IMPORTED);

  if (userId) {
    const submissionLabel =
      submission?.original_name || submission?.file_name || submission?.id || id;
    const driveLabel = drive?.drive_name || resolvedDriveId;
    await activityLogDao.createLog(
      userId,
      'IMPORT_SUBMISSION',
      `Imported ${successCount} cadets from submission ${submissionLabel}${
        driveLabel ? ` for drive ${driveLabel}` : ''
      }`,
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
    if (error.statusCode)
      return res.status(error.statusCode).json({ message: error.message });
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
  submitInstituteExcel,
  getAllSubmissions,
  importSubmission,
  downloadSubmission,
  deleteSubmission,
  bulkDeleteSubmissions,
  bulkImportSubmissions,
  processImport,
  parseSubmissionData,
};
