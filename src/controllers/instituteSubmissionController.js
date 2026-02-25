const instituteDao = require('../dao/instituteDao');
const activityLogDao = require('../dao/activityLogDao');

const cadetDao = require('../dao/cadetDao');

const submitInstituteExcel = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'Excel file is required' });
    }

    if (!req.user || !req.user.instituteId) {
      return res
        .status(401)
        .json({ message: 'Unauthorized. Institute account required.' });
    }

    const instituteId = req.user.instituteId;

    try {
      const institute = await instituteDao.getInstituteById(instituteId);

      if (!institute) {
        return res.status(404).json({ message: 'Institute not found' });
      }

      const adminYear = institute.batch_year;

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
  isRowEmpty,
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

  const { rawData } = parseExcelFile(submissionFile.file_data);
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
    if (isRowEmpty(rowData)) continue;
    try {
      const cadetData = mapRowToCadetData(rowData, headers, submission);
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
  submitInstituteExcel,
  getAllSubmissions,
  importSubmission,
  downloadSubmission,
  deleteSubmission,
  bulkDeleteSubmissions,
  bulkImportSubmissions,
};
