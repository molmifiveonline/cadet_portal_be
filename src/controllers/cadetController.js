const cadetDao = require('../dao/cadetDao');
const instituteDao = require('../dao/instituteDao');
const activityLogDao = require('../dao/activityLogDao');
const shortlistService = require('../services/shortlistService');
const recruitmentDriveDao = require('../dao/recruitmentDriveDao');
const {
  DEFAULT_PAGE_SIZE,
  ROLES,
  EXCEL_HEADER_KEYWORDS,
  SUBMISSION_STATUS,
} = require('../config/constants');
const {
  parseExcelFile,
  findHeaderRow,
  mapRowToCadetData,
  isRowEmpty,
} = require('../services/excelImportService');

const getAllCadets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const search = req.query.search || '';
    // If the logged-in user is an Institute, force their ID instead of trusting the query param
    const instituteId =
      req.user?.role === ROLES.INSTITUTE
        ? req.user.instituteId
        : req.query.instituteId;
    const batch = req.query.batch;
    const batch_year = req.query.batch_year;
    const course_type = req.query.course_type;
    const drive_id = req.query.drive_id;
    const status = req.query.status;

    const offset = (page - 1) * limit;

    const filters = {
      search,
      instituteId,
      batch,
      batch_year,
      course_type,
      drive_id,
      status,
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

    const headerKeywords = EXCEL_HEADER_KEYWORDS;
    const headerInfo = findHeaderRow(rawData, headerKeywords);
    if (!headerInfo) {
      return res
        .status(400)
        .json({ message: 'Could not identify header row in Excel file' });
    }

    const { rowIndex: headerRowIndex, headers } = headerInfo;

    let importedCount = 0;
    let failedCount = 0;

    const timestamp = Date.now();
    const filename = `${instituteId}_${timestamp}_${file.originalname}`;

    const submissionId = await instituteDao.createSubmission(
      instituteId,
      filename,
      file.originalname,
      file.buffer,
    );

    await instituteDao.updateSubmissionStatus(
      submissionId,
      SUBMISSION_STATUS.IMPORTED,
    );

    const mockSubmission = {
      institute_id: instituteId,
      id: submissionId,
    };

    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
      const rowData = rawData[i];
      if (isRowEmpty(rowData)) continue;

      try {
        const cadetData = mapRowToCadetData(rowData, headers, mockSubmission);
        if (batchName) cadetData.batch = batchName;

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

    // Dynamic shortlisting check
    cadet.is_shortlisted = shortlistService.checkShortlistCriteria(cadet);

    if (req.user && req.user.role === ROLES.INSTITUTE && req.user.instituteId) {
      if (cadet.institute_id !== req.user.instituteId) {
        return res
          .status(403)
          .json({ message: 'Unauthorized access to this cadet data' });
      }
    }

    res.json({ data: cadet });
  } catch (error) {
    console.error('Get Cadet By ID Error:', error);
    res
      .status(500)
      .json({ message: 'Error fetching cadet details', error: error.message });
  }
};

const getShortlistedCadets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const search = req.query.search || '';
    const instituteId =
      req.user?.role === ROLES.INSTITUTE
        ? req.user.instituteId
        : req.query.instituteId;

    const batch_year = req.query.batch_year;
    const course_type = req.query.course_type;
    const drive_id = req.query.drive_id;
    const offset = (page - 1) * limit;

    const filters = {
      search,
      instituteId,
      batch_year,
      course_type,
      drive_id,
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

const getInstituteShortlistedCadets = async (req, res) => {
  try {
    const instituteId = req.user?.instituteId;

    if (!instituteId) {
      return res.status(403).json({
        message: 'Access denied. Institute ID not found in token.',
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const search = req.query.search || '';
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
    console.error('Get Institute Shortlisted Cadets Error:', error);
    res.status(500).json({
      message: 'Error fetching shortlisted cadets',
      error: error.message,
    });
  }
};

const createCadet = async (req, res) => {
  try {
    let cadetData = req.body;
    cadetData.status = cadetData.status || 'Assessment';
    delete cadetData.photo;
    delete cadetData.photo_data;
    delete cadetData.photo_mime_type;
    delete cadetData.photo_name;
    delete cadetData.created_at;
    delete cadetData.is_shortlisted;
    delete cadetData.declaration_accepted;

    if (cadetData.institute_id && cadetData.batch_year && cadetData.course) {
      const drive = await recruitmentDriveDao.getDriveByContext(cadetData.institute_id, cadetData.batch_year, cadetData.course);
      if (drive) {
        cadetData.drive_id = drive.id;
      }
    }

    const newCadetId = await cadetDao.createCadet(cadetData);

    if (req.file) {
      await cadetDao.saveCadetPhoto(
        newCadetId,
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );

      const photoPath = `${req.protocol}://${req.get('host')}/api/cadets/${newCadetId}/photo`;
      await cadetDao.updateCadet(newCadetId, { photo_path: photoPath });
    }

    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'CREATE_CADET',
        `Created new cadet: ${cadetData.name_as_in_indos_cert || 'Unknown'}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.status(201).json({
      message: 'Cadet created successfully',
      data: { id: newCadetId },
    });
  } catch (error) {
    console.error('Create Cadet Error:', error);
    res
      .status(500)
      .json({ message: 'Error creating cadet', error: error.message });
  }
};

const updateCadet = async (req, res) => {
  try {
    const { id } = req.params;
    let cadetData = { ...req.body };

    // Prevent overwriting sensitive or managed fields
    delete cadetData.id;
    delete cadetData.photo;
    delete cadetData.photo_data;
    delete cadetData.photo_mime_type;
    delete cadetData.photo_name;
    delete cadetData.created_at;
    delete cadetData.is_shortlisted;
    delete cadetData.declaration_accepted;

    const existingCadet = await cadetDao.getCadetById(id);
    if (!existingCadet) {
      return res.status(404).json({ message: 'Cadet not found' });
    }

    if (req.user && req.user.role === ROLES.INSTITUTE && req.user.instituteId) {
      if (existingCadet.institute_id !== req.user.instituteId) {
        return res
          .status(403)
          .json({ message: 'Unauthorized access to this cadet data' });
      }
    }

    delete cadetData.institute_name;

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

    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'UPDATE_CADET',
        `Updated cadet ${existingCadet.name_as_in_indos_cert}`,
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

    const mimeType = photo.photo_mime_type || 'image/jpeg';
    res.set('Content-Type', mimeType);
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

    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'DELETE_CADET',
        `Deleted cadet ${existingCadet.name_as_in_indos_cert || 'Unknown'}`,
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
  getInstituteShortlistedCadets,
  getShortlistStats,
  createCadet,
  updateCadet,
  getCadetPhoto,
  deleteCadet,
};
