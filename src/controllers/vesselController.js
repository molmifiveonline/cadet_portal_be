const vesselDao = require('../dao/vesselDao');
const activityLogDao = require('../dao/activityLogDao');
const { DEFAULT_PAGE_SIZE } = require('../config/constants');

const createVessel = async (req, res, next) => {
  try {
    const { name, imo_number, vessel_type, flag, status } = req.body;

    if (!name || !imo_number) {
      return res.status(400).json({
        success: false,
        message: 'Vessel Name and IMO Number are required',
      });
    }

    const vesselId = await vesselDao.createVessel({
      name,
      imo_number,
      vessel_type,
      flag,
      status,
    });

    await activityLogDao.createLog(
      req.user.id,
      'CREATE_VESSEL',
      `Created new vessel: ${name} (IMO: ${imo_number})`,
      req.ip,
    );

    res.status(201).json({
      success: true,
      message: 'Vessel created successfully',
      data: { id: vesselId },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'A vessel with this IMO Number already exists.',
      });
    }
    next(error);
  }
};

const getAllVessels = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    // Individual field filters
    const filters = {
      vessel_type: req.query.vessel_type || '',
      flag: req.query.flag || '',
      status: req.query.status || '',
    };

    // Sorting
    const sortKey = req.query.sort_key || 'created_at';
    const sortDir = req.query.sort_dir === 'asc' ? 'ASC' : 'DESC';

    const { data, total } = await vesselDao.getAllVessels(
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

const getVesselById = async (req, res, next) => {
  try {
    const vessel = await vesselDao.getVesselById(req.params.id);

    if (!vessel) {
      return res.status(404).json({
        success: false,
        message: 'Vessel not found',
      });
    }

    res.json({
      success: true,
      data: vessel,
    });
  } catch (error) {
    next(error);
  }
};

const updateVessel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const vesselData = req.body;

    const existingVessel = await vesselDao.getVesselById(id);
    if (!existingVessel) {
      return res.status(404).json({
        success: false,
        message: 'Vessel not found',
      });
    }

    await vesselDao.updateVessel(id, vesselData);

    await activityLogDao.createLog(
      req.user.id,
      'UPDATE_VESSEL',
      `Updated vessel: ${vesselData.name || existingVessel.name}`,
      req.ip,
    );

    res.json({
      success: true,
      message: 'Vessel updated successfully',
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Another vessel with this IMO Number already exists.',
      });
    }
    next(error);
  }
};

const deleteVessel = async (req, res, next) => {
  try {
    const { id } = req.params;

    const vessel = await vesselDao.getVesselById(id);
    if (!vessel) {
      return res.status(404).json({
        success: false,
        message: 'Vessel not found',
      });
    }

    await vesselDao.deleteVessel(id);

    await activityLogDao.createLog(
      req.user.id,
      'DELETE_VESSEL',
      `Deleted vessel: ${vessel.name}`,
      req.ip,
    );

    res.json({
      success: true,
      message: 'Vessel deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createVessel,
  getAllVessels,
  getVesselById,
  updateVessel,
  deleteVessel,
};
