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
const {
  parseExcelFile,
  findHeaderRow,
  mapRowToCadetData,
  isRowEmpty,
} = require('../services/excelImportService');

const normalizeCourseType = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'deck') return 'Deck';
  if (normalized === 'engine') return 'Engine';
  return null;
};

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

      if (!institute) {
        return res.status(404).json({ message: 'Institute not found' });
      }

      const batch_year =
        isAdmin && req.body.batch_year
          ? req.body.batch_year
          : institute.batch_year;
      const requestedCourseType = isAdmin
        ? req.body.course_type
        : institute.submission_course_type || req.body.course_type;
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
        const drive = await recruitmentDriveDao.getDriveByInstituteYearCourseType(
          instituteId,
          batch_year,
          course_type
        );
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

    const offset = (page - 1) * limit;

    const { data, total } = await instituteDao.getAllSubmissions(
      limit,
      offset,
      status,
      search,
      instituteId,
      batchYear,
      courseType,
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

// Helper function for import logic
const processImport = async (id, userId, clientIp, driveId = null) => {
  const submission = await instituteDao.getSubmissionById(id);
  if (!submission) throw new Error('Submission not found');
  if (submission.status === SUBMISSION_STATUS.IMPORTED)
    throw new Error('Submission already imported');

  const submissionFile = await instituteDao.getSubmissionFile(id);
  if (!submissionFile || !submissionFile.file_data)
    throw new Error('File data not found');

  const { rawData } = parseExcelFile(submissionFile.file_data);
  const headerKeywords = EXCEL_HEADER_KEYWORDS;
  const headerInfo = findHeaderRow(rawData, headerKeywords);
  if (!headerInfo)
    throw new Error('Could not identify header row in Excel file');

  const { rowIndex: headerRowIndex, headers } = headerInfo;
  let successCount = 0;
  let failedCount = 0;

  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const rowData = rawData[i];
    if (isRowEmpty(rowData)) continue;
    try {
      const cadetData = mapRowToCadetData(rowData, headers, submission);
      if (driveId) cadetData.drive_id = driveId;

      if (cadetData.name_as_in_indos_cert) {
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

  await instituteDao.updateSubmissionStatus(id, SUBMISSION_STATUS.IMPORTED);

  if (userId) {
    await activityLogDao.createLog(
      userId,
      'IMPORT_SUBMISSION',
      `Imported ${successCount} cadets from submission ${id}${driveId ? ` for drive ${driveId}` : ''}`,
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
  submitInstituteExcel,
  getAllSubmissions,
  importSubmission,
  downloadSubmission,
  deleteSubmission,
  bulkDeleteSubmissions,
  bulkImportSubmissions,
  processImport, // Export this for other controllers
};
