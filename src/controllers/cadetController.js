const cadetDao = require('../dao/cadetDao');
const instituteDao = require('../dao/instituteDao');
const activityLogDao = require('../dao/activityLogDao');
const {
  parseExcelFile,
  findHeaderRow,
  mapRowToCadetData,
  isRowEmpty,
} = require('../services/excelImportService');

const getAllCadets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    // If the logged-in user is an Institute, force their ID instead of trusting the query param
    const instituteId =
      req.user?.role === 'Institute'
        ? req.user.instituteId
        : req.query.instituteId;
    const batch = req.query.batch;
    const batchId = req.query.batchId; // Legacy support if needed, or map to batch name

    const offset = (page - 1) * limit;

    const filters = {
      search,
      instituteId,
      batch,
    };

    const { data, total } = await cadetDao.getAllCadets(limit, offset, filters);

    res.json({
      data,
      total,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get All Cadets Error:', error);
    res
      .status(500)
      .json({ message: 'Error fetching cadets', error: error.message });
  }
};

const importCadets = async (req, res) => {
  try {
    const file = req.file;
    const { instituteId, batchName } = req.body;

    if (!file) {
      return res.status(400).json({ message: 'Excel file is required' });
    }

    if (!instituteId) {
      return res.status(400).json({ message: 'Institute ID is required' });
    }

    const { rawData } = parseExcelFile(file.buffer);

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

    // Process Data
    let importedCount = 0;
    let failedCount = 0;

    // Create a manual submission record
    const timestamp = Date.now();
    const filename = `${instituteId}_${timestamp}_${file.originalname}`;

    // We need to import instituteDao to create submission

    const submissionId = await instituteDao.createSubmission(
      instituteId,
      filename,
      file.originalname,
      file.buffer,
    );

    // Auto-approve/import status since it's an admin import
    await instituteDao.updateSubmissionStatus(submissionId, 'imported');

    // Create a mock submission object for mapping compatibility
    const mockSubmission = {
      institute_id: instituteId,
      id: submissionId,
    };

    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
      const rowData = rawData[i];
      if (isRowEmpty(rowData)) continue;

      try {
        const cadetData = mapRowToCadetData(rowData, headers, mockSubmission);

        // Override or fill in manual data
        if (batchName) cadetData.batch = batchName;

        // Minimal requirement: Name
        if (cadetData.name_as_in_indos_cert) {
          await cadetDao.createCadet(cadetData);
          importedCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        console.error('Error importing row:', i, err);
        failedCount++;
      }
    }

    // Log Activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'IMPORT_CADETS',
        `Imported ${importedCount} cadets for institute ${instituteId}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      success: true,
      message: 'Import completed',
      imported: importedCount,
      failed: failedCount,
    });
  } catch (error) {
    console.error('Import Cadets Error:', error);
    res
      .status(500)
      .json({ message: 'Error importing cadets', error: error.message });
  }
};

const getCadetById = async (req, res) => {
  try {
    const { id } = req.params;
    const cadet = await cadetDao.getCadetById(id);

    if (!cadet) {
      return res.status(404).json({ message: 'Cadet not found' });
    }

    res.json({ data: cadet });
  } catch (error) {
    console.error('Get Cadet By ID Error:', error);
    res
      .status(500)
      .json({ message: 'Error fetching cadet details', error: error.message });
  }
};

// Import shortlist services
const shortlistService = require('../services/shortlistService');

/**
 * Get all shortlisted cadets with pagination and filters
 */
const getShortlistedCadets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    // Force scoping for Institute users
    const instituteId =
      req.user?.role === 'Institute'
        ? req.user.instituteId
        : req.query.instituteId;

    const offset = (page - 1) * limit;

    const filters = {
      search,
      instituteId,
    };

    const { data, total } = await shortlistService.getShortlistedCadets(
      limit,
      offset,
      filters,
    );

    res.json({
      data,
      total,
      page,
      limit,
      last_page: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Get Shortlisted Cadets Error:', error);
    res.status(500).json({
      message: 'Error fetching shortlisted cadets',
      error: error.message,
    });
  }
};

/**
 * Get shortlist statistics by institute
 */
const getShortlistStats = async (req, res) => {
  try {
    const stats = await shortlistService.getShortlistStats();
    res.json(stats);
  } catch (error) {
    console.error('Get Shortlist Stats Error:', error);
    res.status(500).json({
      message: 'Error fetching shortlist statistics',
      error: error.message,
    });
  }
};

const updateCadet = async (req, res) => {
  try {
    const { id } = req.params;
    let cadetData = req.body;

    // Check if cadet exists
    const existingCadet = await cadetDao.getCadetById(id);
    if (!existingCadet) {
      return res.status(404).json({ message: 'Cadet not found' });
    }

    // Handle photo upload — save to database
    if (req.file) {
      await cadetDao.saveCadetPhoto(
        id,
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );

      const photoPath = `${req.protocol}://${req.get('host')}/api/cadets/${id}/photo`;
      cadetData = { ...cadetData, photo_path: photoPath };
    }

    await cadetDao.updateCadet(id, cadetData);

    // Log Activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'UPDATE_CADET',
        `Updated cadet ${existingCadet.name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({ message: 'Cadet updated successfully' });
  } catch (error) {
    console.error('Update Cadet Error:', error);
    res
      .status(500)
      .json({ message: 'Error updating cadet', error: error.message });
  }
};

const getCadetPhoto = async (req, res) => {
  try {
    const { id } = req.params;
    const photo = await cadetDao.getCadetPhoto(id);

    if (!photo) {
      return res.status(404).json({ message: 'Photo not found' });
    }

    res.set('Content-Type', photo.photo_mime_type);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(photo.photo_data);
  } catch (error) {
    console.error('Get Cadet Photo Error:', error);
    res
      .status(500)
      .json({ message: 'Error fetching photo', error: error.message });
  }
};

const deleteCadet = async (req, res) => {
  try {
    const { id } = req.params;

    const existingCadet = await cadetDao.getCadetById(id);
    if (!existingCadet) {
      return res.status(404).json({ message: 'Cadet not found' });
    }

    await cadetDao.deleteCadet(id);

    // Log Activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'DELETE_CADET',
        `Deleted cadet ${existingCadet.name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({ message: 'Cadet deleted successfully' });
  } catch (error) {
    console.error('Delete Cadet Error:', error);
    res
      .status(500)
      .json({ message: 'Error deleting cadet', error: error.message });
  }
};

module.exports = {
  getAllCadets,
  importCadets,
  getCadetById,
  getShortlistedCadets,

  getShortlistStats,
  updateCadet,
  getCadetPhoto,
  deleteCadet,
};
