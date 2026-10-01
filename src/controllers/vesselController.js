const vesselDao = require('../dao/vesselDao');
const activityLogDao = require('../dao/activityLogDao');
const { DEFAULT_PAGE_SIZE } = require('../config/constants');
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { listVesselMasterTypes, findVesselMasterType } = require('../services/vesselMasterService');

const getVesselMasterTypes = async (req, res, next) => {
  try {
    const data = await listVesselMasterTypes();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const validateMasterType = (body = {}) => {
  const errors = {};
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Vessel Type Name is required.';
  else if (name.length > 100) errors.name = 'Vessel Type Name cannot exceed 100 characters.';
  const department = body.department || 'Both';
  if (!['Deck', 'Engine', 'Both'].includes(department)) errors.department = 'Choose Deck, Engine or Both.';
  return { errors, name, department };
};

const sendDuplicateMasterType = (res) => res.status(409).json({
  success: false,
  message: 'Vessel Type already exists.',
  errors: { name: 'Use a different Vessel Type Name.' },
});

const createVesselMasterType = async (req, res, next) => {
  const { errors, name, department } = validateMasterType(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ success: false, errors, message: 'Please correct the vessel type fields.' });
  try {
    const id = uuidv4();
    await db.query(
      `INSERT INTO vessel_types (id, name, department, status, is_master, created_by)
       VALUES (?, ?, ?, 'Active', 1, ?)`,
      [id, name, department, req.user.id],
    );
    await activityLogDao.createLog(req.user.id, 'CREATE_VESSEL_TYPE',
      `Created Vessel Type ${name} (${department}); status: Active`, req.ip || req.connection?.remoteAddress);
    res.status(201).json({ success: true, message: 'Vessel Type added.', data: { id } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return sendDuplicateMasterType(res);
    next(error);
  }
};

const updateVesselMasterType = async (req, res, next) => {
  const { errors, name, department } = validateMasterType(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ success: false, errors, message: 'Please correct the vessel type fields.' });
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT id, name, department FROM vessel_types WHERE id = ? AND is_master = 1 FOR UPDATE',
      [req.params.id],
    );
    if (!rows[0]) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Vessel Type not found.' });
    }
    await connection.query(
      'UPDATE vessel_types SET name = ?, department = ? WHERE id = ?',
      [name, department, req.params.id],
    );
    await connection.query(
      'UPDATE vessels SET vessel_type = ? WHERE vessel_type_id = ?',
      [name, req.params.id],
    );
    if (rows[0].name !== name) {
      await connection.query(
        'UPDATE vessels SET vessel_type = ? WHERE vessel_type_id IS NULL AND vessel_type = ?',
        [name, rows[0].name],
      );
      await connection.query(
        'UPDATE joining_plans SET vessel_type = ? WHERE vessel_type = ?',
        [name, rows[0].name],
      );
    }
    await activityLogDao.createLog(req.user.id, 'UPDATE_VESSEL_TYPE',
      `Updated Vessel Type ${rows[0].name} to ${name}; department: ${rows[0].department} to ${department}`,
      req.ip || req.connection?.remoteAddress, connection);
    await connection.commit();
    res.json({ success: true, message: 'Vessel Type updated.' });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return sendDuplicateMasterType(res);
    next(error);
  } finally {
    if (connection) connection.release();
  }
};

const setVesselMasterTypeStatus = async (req, res, next) => {
  const { status } = req.body || {};
  if (!['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be Active or Inactive.' });
  }
  try {
    const [types] = await db.query('SELECT name,department,status FROM vessel_types WHERE id=? AND is_master=1', [req.params.id]);
    if (!types[0]) return res.status(404).json({ success: false, message: 'Vessel Type not found.' });
    const [result] = await db.query(
      'UPDATE vessel_types SET status = ? WHERE id = ? AND is_master = 1',
      [status, req.params.id],
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Vessel Type not found.' });
    if (types[0].status !== status) {
      await activityLogDao.createLog(req.user.id, status === 'Active' ? 'ACTIVATE_VESSEL_TYPE' : 'DEACTIVATE_VESSEL_TYPE',
        `${status === 'Active' ? 'Activated' : 'Deactivated'} Vessel Type ${types[0].name} (${types[0].department}); status: ${types[0].status} to ${status}`,
        req.ip || req.connection?.remoteAddress);
    }
    res.json({ success: true, message: `Vessel Type ${status.toLowerCase()}.` });
  } catch (error) {
    next(error);
  }
};

const validateVessel = (data = {}) => {
  const errors = {};
  if (!String(data.name || '').trim()) errors.name = 'Vessel Name is required.';
  if (!String(data.imo_number || '').trim()) errors.imo_number = 'IMO Number is required.';
  if (!['Deck', 'Engine', 'Both'].includes(data.department)) errors.department = 'Department Compatibility is required.';
  return errors;
};

const createVessel = async (req, res, next) => {
  try {
    const {
      name, imo_number, vessel_type, vessel_type_id, flag, status, location,
      total_seats, voyage_ref, reporting_port,
      contact_person_name, contact_person_email,
      contact_person_phone, department = 'Both',
    } = req.body;

    const errors = validateVessel({ name, imo_number, department, total_seats });
    if (Object.keys(errors).length) {
      return res.status(400).json({
        success: false,
        message: 'Please correct the highlighted vessel fields.',
        errors,
      });
    }

    const masterType = await findVesselMasterType({ id: vessel_type_id, name: vessel_type });
    if (!masterType || masterType.status !== 'Active') {
      return res.status(400).json({ success: false, message: 'Choose an active Vessel Type.', errors: { vessel_type: 'Choose an active Vessel Type.' } });
    }
    const vesselId = await vesselDao.createVessel({
      name: name.trim(),
      imo_number: String(imo_number).trim(),
      vessel_type: masterType.name,
      vessel_type_id: masterType.id,
      department,
      flag,
      status,
      location,
      total_seats: Number(total_seats),
      voyage_ref,
      reporting_port,
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
    delete vesselData.communication_details;

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

    if (vesselData.vessel_type_id || vesselData.vessel_type) {
      const masterType = await findVesselMasterType({ id: vesselData.vessel_type_id, name: vesselData.vessel_type });
      if (!masterType || (masterType.status !== 'Active' && masterType.id !== existingVessel.vessel_type_id)) {
        return res.status(400).json({ success: false, message: 'Choose an active Vessel Type.', errors: { vessel_type: 'Choose an active Vessel Type.' } });
      }
      vesselData.vessel_type_id = masterType.id;
      vesselData.vessel_type = masterType.name;
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

    const deleted = await vesselDao.deleteVessel(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Vessel not found' });
    }

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
  getVesselMasterTypes,
  createVesselMasterType,
  updateVesselMasterType,
  setVesselMasterTypeStatus,
  createVessel,
  getAllVessels,
  getVesselById,
  updateVessel,
  deleteVessel,
};
