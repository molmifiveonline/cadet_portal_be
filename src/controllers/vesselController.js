const vesselDao = require('../dao/vesselDao');
const activityLogDao = require('../dao/activityLogDao');
const { DEFAULT_PAGE_SIZE } = require('../config/constants');
const db = require('../config/database');

const validateVessel = (data = {}) => {
  const errors = {};
  if (!String(data.name || '').trim()) errors.name = 'Vessel Name is required.';
  if (!String(data.imo_number || '').trim()) errors.imo_number = 'IMO Number is required.';
  if (!String(data.vessel_type || '').trim()) errors.vessel_type = 'Vessel Type is required.';
  if (!['Deck', 'Engine', 'Both'].includes(data.department)) errors.department = 'Department Compatibility is required.';
  return errors;
};

const resolveVesselType = async (name, department = 'Both') => {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return null;
  const [rows] = await db.query(`SELECT * FROM vessel_types WHERE LOWER(name)=LOWER(?) LIMIT 1`, [normalizedName]);
  if (rows[0]) {
    const compatibleDepartment = rows[0].department === department ? department : 'Both';
    await db.query(`UPDATE vessel_types SET department=?,status='Active' WHERE id=?`, [compatibleDepartment, rows[0].id]);
    return rows[0].id;
  }
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  await db.query(`INSERT INTO vessel_types (id,name,department,status) VALUES (?,?,?,'Active')`, [id, normalizedName, department]);
  return id;
};

const createVessel = async (req, res, next) => {
  try {
    const {
      name, imo_number, vessel_type, flag, status, location,
      total_seats, voyage_ref, reporting_port,
      communication_details, contact_person_name, contact_person_email,
      contact_person_phone, department = 'Both',
    } = req.body;

    const errors = validateVessel({ name, imo_number, vessel_type, department, total_seats });
    if (Object.keys(errors).length) {
      return res.status(400).json({
        success: false,
        message: 'Please correct the highlighted vessel fields.',
        errors,
      });
    }

    const vessel_type_id = await resolveVesselType(vessel_type, department);
    const vesselId = await vesselDao.createVessel({
      name: name.trim(),
      imo_number: String(imo_number).trim(),
      vessel_type: vessel_type.trim(),
      vessel_type_id,
      department,
      flag,
      status,
      location,
      total_seats: Number(total_seats),
      voyage_ref,
      reporting_port,
      communication_details,
      contact_person_name,
      contact_person_email,
      contact_person_phone,
    });

    await activityLogDao.createLog(
      req.user.id,
      'CREATE_VESSEL',
      `Created new vessel: ${name} (IMO: ${imo_number})`,
      req.ip || req.connection.remoteAddress,
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
        errors: { imo_number: 'This IMO Number is already used by another vessel.' },
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
    const vesselData = { ...req.body };
    delete vesselData.joining_date;
    delete vesselData.required_documents;

    const existingVessel = await vesselDao.getVesselById(id);
    if (!existingVessel) {
      return res.status(404).json({
        success: false,
        message: 'Vessel not found',
      });
    }

    const errors = validateVessel({ ...existingVessel, ...vesselData });
    if (Object.keys(errors).length) {
      return res.status(400).json({ success: false, message: 'Please correct the highlighted vessel fields.', errors });
    }

    if (vesselData.vessel_type) {
      vesselData.vessel_type_id = await resolveVesselType(vesselData.vessel_type, vesselData.department || existingVessel.department || 'Both');
    }
    await vesselDao.updateVessel(id, vesselData);

    await activityLogDao.createLog(
      req.user.id,
      'UPDATE_VESSEL',
      `Updated vessel: ${vesselData.name || existingVessel.name}`,
      req.ip || req.connection.remoteAddress,
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
        errors: { imo_number: 'This IMO Number is already used by another vessel.' },
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
      req.ip || req.connection.remoteAddress,
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
