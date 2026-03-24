const medicalCenterDao = require('../dao/medicalCenterDao');
const activityLogDao = require('../dao/activityLogDao');
const { DEFAULT_PAGE_SIZE } = require('../config/constants');

const createMedicalCenter = async (req, res, next) => {
  try {
    const { center_name, location, email } = req.body;

    if (!center_name || !location) {
      return res.status(400).json({
        success: false,
        message: 'Center Name and Location are required.',
      });
    }

    if (email) {
      const existingCenter =
        await medicalCenterDao.getMedicalCenterByEmail(email);
      if (existingCenter) {
        return res.status(400).json({
          success: false,
          message: 'A Medical Center with this email already exists.',
        });
      }
    }

    const newCenterId = await medicalCenterDao.createMedicalCenter(req.body);

    await activityLogDao.createLog(
      req.user.id,
      'CREATE_MEDICAL_CENTER',
      `Created new Medical Center: ${center_name}`,
      req.ip || req.connection.remoteAddress,
    );

    res.status(201).json({
      success: true,
      message: 'Medical Center created successfully',
      data: { id: newCenterId, ...req.body },
    });
  } catch (error) {
    next(error);
  }
};

const getAllMedicalCenters = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    // Individual field filters
    const filters = {
      location: req.query.location || '',
      status: req.query.status || '',
      contact_person: req.query.contact_person || '',
      tests_offered: req.query.tests_offered || '',
    };

    // Sorting
    const sortKey = req.query.sort_key || 'created_at';
    const sortDir = req.query.sort_dir === 'asc' ? 'ASC' : 'DESC';

    const { data, total } = await medicalCenterDao.getAllMedicalCenters(
      limit,
      offset,
      search,
      filters,
      sortKey,
      sortDir,
    );

    res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getMedicalCenterById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const center = await medicalCenterDao.getMedicalCenterById(id);

    if (!center) {
      return res
        .status(404)
        .json({ success: false, message: 'Medical Center not found' });
    }

    res.json({
      success: true,
      data: center,
    });
  } catch (error) {
    next(error);
  }
};

const updateMedicalCenter = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { center_name, location, email } = req.body;

    if (!center_name || !location) {
      return res.status(400).json({
        success: false,
        message: 'Center Name and Location are required.',
      });
    }

    const currentCenter = await medicalCenterDao.getMedicalCenterById(id);
    if (!currentCenter) {
      return res
        .status(404)
        .json({ success: false, message: 'Medical center not found' });
    }

    if (email && email !== currentCenter.email) {
      const existingCenter =
        await medicalCenterDao.getMedicalCenterByEmail(email);
      if (existingCenter) {
        return res.status(400).json({
          success: false,
          message: 'A Medical Center with this email already exists.',
        });
      }
    }

    await medicalCenterDao.updateMedicalCenter(id, req.body);

    await activityLogDao.createLog(
      req.user.id,
      'UPDATE_MEDICAL_CENTER',
      `Updated Medical Center: ${center_name}`,
      req.ip || req.connection.remoteAddress,
    );

    res.json({
      success: true,
      message: 'Medical Center updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

const deleteMedicalCenter = async (req, res, next) => {
  try {
    const { id } = req.params;

    const center = await medicalCenterDao.getMedicalCenterById(id);
    if (!center) {
      return res
        .status(404)
        .json({ success: false, message: 'Medical center not found' });
    }

    await medicalCenterDao.deleteMedicalCenter(id);

    await activityLogDao.createLog(
      req.user.id,
      'DELETE_MEDICAL_CENTER',
      `Deleted Medical Center: ${center.center_name}`,
      req.ip || req.connection.remoteAddress,
    );

    res.json({
      success: true,
      message: 'Medical Center deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createMedicalCenter,
  getAllMedicalCenters,
  getMedicalCenterById,
  updateMedicalCenter,
  deleteMedicalCenter,
};
