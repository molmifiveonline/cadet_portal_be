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
const { DISPLAY_STATUS, WORKFLOW_PHASES } = require('../services/recruitmentWorkflowService');
const {
  parseExcelFile,
  findHeaderRow,
  mapRowToCadetData,
  isRowEmpty,
  validateExcelPhoneFields,
  validateExcelGenderFields,
} = require('../services/excelImportService');
const { parseCadetCvTemplate } = require('../services/cvTemplateService');
const {
  getEmailValidationMessage,
  getPhoneValidationMessage,
  sanitizePhoneValue,
} = require('../utils/validationUtils');

const sanitizeAndValidateCadetPhone = (cadetData) => {
  if (!cadetData || cadetData.contact_number === undefined) return '';

  cadetData.contact_number = sanitizePhoneValue(cadetData.contact_number);
  return getPhoneValidationMessage(cadetData.contact_number, 'Phone');
};

const validateCadetEmail = (cadetData) => {
  if (!cadetData || cadetData.email_id === undefined) return '';
  return getEmailValidationMessage(cadetData.email_id);
};

const formatBytesAsMb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

const validatePhotoPacketSize = async (file) => {
  if (!file || !file.size) return null;

  const maxAllowedPacket = await cadetDao.getMaxAllowedPacket();
  if (!maxAllowedPacket) return null;

  const packetHeadroomBytes = 64 * 1024;
  const maxSafePhotoSize = Math.max(0, maxAllowedPacket - packetHeadroomBytes);

  if (file.size > maxSafePhotoSize) {
    return `Photo is too large for the database upload limit. Please upload an image smaller than ${formatBytesAsMb(maxSafePhotoSize)} MB.`;
  }

  return null;
};

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
    const phoneValidationMessage = validateExcelPhoneFields(
      rawData,
      headers,
      headerRowIndex + 1,
    );
    if (phoneValidationMessage) {
      return res.status(400).json({ message: phoneValidationMessage });
    }

    const genderValidationMessage = validateExcelGenderFields(
      rawData,
      headers,
      headerRowIndex + 1,
    );
    if (genderValidationMessage) {
      return res.status(400).json({ message: genderValidationMessage });
    }

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

        const phoneValidationMessage = sanitizeAndValidateCadetPhone(cadetData);
        if (phoneValidationMessage) {
          return res.status(400).json({ message: phoneValidationMessage });
        }

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
    cadetData.status = cadetData.status || DISPLAY_STATUS.UPLOADED;
    cadetData.workflow_phase = cadetData.workflow_phase || WORKFLOW_PHASES.UPLOADED;
    cadetData.workflow_result = cadetData.workflow_result || 'pending';
    delete cadetData.photo;
    delete cadetData.photo_data;
    delete cadetData.photo_mime_type;
    delete cadetData.photo_name;
    delete cadetData.created_at;
    delete cadetData.is_shortlisted;
    delete cadetData.declaration_accepted;

    const phoneValidationMessage = sanitizeAndValidateCadetPhone(cadetData);
    if (phoneValidationMessage) {
      return res.status(400).json({ message: phoneValidationMessage });
    }

    if (!cadetData.gender || String(cadetData.gender).trim() === '') {
      return res.status(400).json({ message: 'Gender is a mandatory field' });
    }
    const genderVal = String(cadetData.gender).trim().toLowerCase();
    if (genderVal !== 'male' && genderVal !== 'female') {
      return res.status(400).json({ message: 'Gender must be either Male or Female' });
    }

    const emailValidationMessage = validateCadetEmail(cadetData);
    if (emailValidationMessage) {
      return res.status(400).json({ message: emailValidationMessage });
    }

    if (cadetData.institute_id && cadetData.batch_year && cadetData.course) {
      const drive = await recruitmentDriveDao.getDriveByContext(cadetData.institute_id, cadetData.batch_year, cadetData.course);
      if (drive) {
        cadetData.drive_id = drive.id;
      }
    }

    if (req.file && req.file.size > 0) {
      const photoValidationMessage = await validatePhotoPacketSize(req.file);
      if (photoValidationMessage) {
        return res.status(413).json({ message: photoValidationMessage });
      }
    }

    const newCadetId = await cadetDao.createCadet(cadetData);

    if (req.file && req.file.size > 0) {
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
    if (
      error.code === 'ER_NET_PACKET_TOO_LARGE' ||
      error.message?.includes('max_allowed_packet')
    ) {
      return res.status(413).json({
        message:
          'Photo is too large for the database upload limit. Please upload a smaller image.',
        error: error.message,
      });
    }

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

    // For institute users, only allow editing personal/academic fields
    if (req.user && req.user.role === ROLES.INSTITUTE) {
      const protectedFields = [
        'status',
        'workflow_phase',
        'workflow_result',
        'drive_id',
        'shortlisted_at',
        'assessment_invitation_sent_at',
        'assessment_score',
        'assessment_result',
        'interview_score',
        'interview_result',
        'medical_result',
        'medical_date',
        'final_selection_status',
      ];
      protectedFields.forEach((field) => delete cadetData[field]);
    }

    const phoneValidationMessage = sanitizeAndValidateCadetPhone(cadetData);
    if (phoneValidationMessage) {
      return res.status(400).json({ message: phoneValidationMessage });
    }

    if (cadetData.gender !== undefined) {
      if (!cadetData.gender || String(cadetData.gender).trim() === '') {
        return res.status(400).json({ message: 'Gender is a mandatory field' });
      }
      const genderVal = String(cadetData.gender).trim().toLowerCase();
      if (genderVal !== 'male' && genderVal !== 'female') {
        return res.status(400).json({ message: 'Gender must be either Male or Female' });
      }
    }

    const emailValidationMessage = validateCadetEmail(cadetData);
    if (emailValidationMessage) {
      return res.status(400).json({ message: emailValidationMessage });
    }

    if (req.file && req.file.size > 0) {
      const photoValidationMessage = await validatePhotoPacketSize(req.file);
      if (photoValidationMessage) {
        return res.status(413).json({ message: photoValidationMessage });
      }

      await cadetDao.saveCadetPhoto(
        id,
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );

      const photoPath = `${req.protocol}://${req.get('host')}/api/cadets/${id}/photo`;
      cadetData = { ...cadetData, photo_path: photoPath };
    }

    // Check if mandatory fields are filled
    const mandatoryFields = [
      'name_as_in_indos_cert',
      'email_id',
      'contact_number',
      'date_of_birth',
      'gender',
      'tenth_avg_percentage',
      'tenth_std_maths',
      'tenth_std_science',
      'tenth_std_english',
      'twelfth_pcm_avg_percentage',
      'twelfth_std_english',
      'imu_rank',
    ];

    const updatedCadet = { ...existingCadet, ...cadetData };
    const allFilled = mandatoryFields.every(
      (field) => updatedCadet[field] !== null && updatedCadet[field] !== '',
    );

    if (allFilled) {
      cadetData.institute_detail_filled = 1;
    } else {
      cadetData.institute_detail_filled = 0;
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
    if (
      error.code === 'ER_NET_PACKET_TOO_LARGE' ||
      error.message?.includes('max_allowed_packet')
    ) {
      return res.status(413).json({
        message:
          'Photo is too large for the database upload limit. Please upload a smaller image.',
        error: error.message,
      });
    }

    res
      .status(500)
      .json({ message: 'Error updating cadet', error: error.message });
  }
};

const uploadCadetCvTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'Excel file is required' });
    }

    const isExcelFile =
      file.originalname?.toLowerCase().endsWith('.xlsx') ||
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (!isExcelFile) {
      return res.status(400).json({
        message: 'Please upload the completed .xlsx CV template.',
      });
    }

    const existingCadet = req.cadet || await cadetDao.getCadetById(id);
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

    const { errors, data } = await parseCadetCvTemplate(file.buffer, {
      cadet: existingCadet,
      driveId: req.body.drive_id || req.body.driveId || existingCadet.drive_id,
    });

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'CV template validation failed',
        errors,
      });
    }

    const updatedCadet = { ...existingCadet, ...data };
    const mandatoryFields = [
      'name_as_in_indos_cert',
      'email_id',
      'contact_number',
      'date_of_birth',
      'gender',
      'tenth_avg_percentage',
      'tenth_std_maths',
      'tenth_std_science',
      'tenth_std_english',
      'twelfth_pcm_avg_percentage',
      'twelfth_std_english',
      'imu_rank',
    ];

    const allFilled = mandatoryFields.every(
      (field) => updatedCadet[field] !== null && updatedCadet[field] !== '',
    );

    await cadetDao.updateCadet(id, {
      ...data,
      institute_detail_filled: allFilled ? 1 : 0,
    });

    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'UPLOAD_CADET_CV_TEMPLATE',
        `Uploaded completed CV template for cadet ${existingCadet.name_as_in_indos_cert || existingCadet.cadet_unique_id || id}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      success: true,
      message: 'Cadet CV details updated successfully',
      institute_detail_filled: allFilled ? 1 : 0,
    });
  } catch (error) {
    console.error('Upload Cadet CV Template Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing cadet CV template',
      error: error.message,
    });
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
  uploadCadetCvTemplate,
  getCadetPhoto,
  deleteCadet,
};
