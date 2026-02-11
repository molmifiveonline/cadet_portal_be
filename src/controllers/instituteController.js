const instituteDao = require('../dao/instituteDao');
const activityLogDao = require('../dao/activityLogDao');

const createInstitute = async (req, res) => {
  try {
    const {
      institute_name,
      institute_email,
      mobile_number,
      address,
      location,
    } = req.body;

    if (
      !institute_name ||
      !institute_email ||
      !mobile_number ||
      !address ||
      !location
    ) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (!/^\d{10}$/.test(mobile_number)) {
      return res
        .status(400)
        .json({ message: 'Mobile number must be a 10-digit number' });
    }

    const id = await instituteDao.createInstitute({
      institute_name,
      institute_email,
      mobile_number,
      address,
      location,
    });

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'CREATE_INSTITUTE',
        `Created institute: ${institute_name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.status(201).json({
      message: 'Institute created successfully',
      id,
    });
  } catch (error) {
    console.error('Create Institute Error:', error);
    res
      .status(500)
      .json({ message: 'Error creating institute', error: error.message });
  }
};

const getAllInstitutes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    let sortBy = req.query.sortBy || 'created_at';
    let sortOrder = req.query.sortOrder || 'DESC';

    // Basic validation for sortBy and sortOrder to prevent SQL injection
    const validColumns = [
      'id',
      'institute_name',
      'institute_email',
      'mobile_number',
      'address',
      'location',
      'created_at',
      'updated_at',
    ];
    if (!validColumns.includes(sortBy)) {
      sortBy = 'created_at';
    }

    if (!['ASC', 'DESC'].includes(sortOrder.toUpperCase())) {
      sortOrder = 'DESC';
    } else {
      sortOrder = sortOrder.toUpperCase();
    }

    const offset = (page - 1) * limit;

    const { data, total } = await instituteDao.getAllInstitutes(
      limit,
      offset,
      sortBy,
      sortOrder,
      search,
    );

    res.json({
      data,
      total,
      page,
      limit,
      search,
    });
  } catch (error) {
    console.error('Get All Institutes Error:', error);
    res
      .status(500)
      .json({ message: 'Error fetching institutes', error: error.message });
  }
};

const getInstituteById = async (req, res) => {
  try {
    const { id } = req.params;
    const institute = await instituteDao.getInstituteById(id);

    if (!institute) {
      return res.status(404).json({ message: 'Institute not found' });
    }

    res.json({ data: institute });
  } catch (error) {
    console.error('Get Institute By Id Error:', error);
    res
      .status(500)
      .json({ message: 'Error fetching institute', error: error.message });
  }
};

const updateInstitute = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      institute_name,
      institute_email,
      mobile_number,
      address,
      location,
    } = req.body;

    if (
      !institute_name ||
      !institute_email ||
      !mobile_number ||
      !address ||
      !location
    ) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (!/^\d{10}$/.test(mobile_number)) {
      return res
        .status(400)
        .json({ message: 'Mobile number must be a 10-digit number' });
    }

    const success = await instituteDao.updateInstitute(id, {
      institute_name,
      institute_email,
      mobile_number,
      address,
      location,
    });

    if (!success) {
      return res
        .status(404)
        .json({ message: 'Institute not found or no changes made' });
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'UPDATE_INSTITUTE',
        `Updated institute: ${institute_name} (ID: ${id})`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({ message: 'Institute updated successfully' });
  } catch (error) {
    console.error('Update Institute Error:', error);
    res
      .status(500)
      .json({ message: 'Error updating institute', error: error.message });
  }
};

const deleteInstitute = async (req, res) => {
  try {
    const { id } = req.params;

    // Get institute name before deleting for the log
    const institute = await instituteDao.getInstituteById(id);
    const instituteName = institute ? institute.institute_name : `ID: ${id}`;

    const success = await instituteDao.deleteInstitute(id);

    if (!success) {
      return res.status(404).json({ message: 'Institute not found' });
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'DELETE_INSTITUTE',
        `Deleted institute: ${instituteName}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({ message: 'Institute deleted successfully' });
  } catch (error) {
    console.error('Delete Institute Error:', error);
    res
      .status(500)
      .json({ message: 'Error deleting institute', error: error.message });
  }
};

module.exports = {
  createInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  deleteInstitute,
};
