const recruitmentDriveDao = require('../dao/recruitmentDriveDao');
const activityLogDao = require('../dao/activityLogDao');
const { DEFAULT_PAGE_SIZE } = require('../config/constants');

const createRecruitmentDrive = async (req, res) => {
  try {
    const {
      drive_name,
      institute_id,
      course_type,
      intake_capacity,
      eligibility_criteria,
      status
    } = req.body;

    if (!drive_name || !institute_id || !course_type) {
      return res.status(400).json({ message: 'Required fields are missing' });
    }

    const id = await recruitmentDriveDao.createRecruitmentDrive({
      drive_name,
      institute_id,
      course_type,
      intake_capacity: intake_capacity || 0,
      eligibility_criteria,
      status: status || 'Draft'
    });

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'CREATE_RECRUITMENT_DRIVE',
        `Created recruitment drive: ${drive_name}`,
        req.ip || req.connection.remoteAddress
      );
    }

    res.status(201).json({
      message: 'Recruitment drive created successfully',
      id
    });
  } catch (error) {
    console.error('Create Recruitment Drive Error:', error);
    res.status(500).json({
      message: 'Error creating recruitment drive',
      error: error.message
    });
  }
};

const getAllRecruitmentDrives = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const search = req.query.search || '';
    const institute_id = req.query.institute_id;
    const course_type = req.query.course_type;
    const status = req.query.status;

    const offset = (page - 1) * limit;

    const filters = {
      institute_id,
      course_type,
      status,
      search
    };

    const { data, total } = await recruitmentDriveDao.getAllRecruitmentDrives(
      limit,
      offset,
      filters
    );

    res.json({
      data,
      total,
      page,
      limit,
      search
    });
  } catch (error) {
    console.error('Get All Recruitment Drives Error:', error);
    res.status(500).json({
      message: 'Error fetching recruitment drives',
      error: error.message
    });
  }
};

const getRecruitmentDriveById = async (req, res) => {
  try {
    const { id } = req.params;
    const drive = await recruitmentDriveDao.getRecruitmentDriveById(id);

    if (!drive) {
      return res.status(404).json({ message: 'Recruitment drive not found' });
    }

    res.json({ data: drive });
  } catch (error) {
    console.error('Get Recruitment Drive By Id Error:', error);
    res.status(500).json({
      message: 'Error fetching recruitment drive',
      error: error.message
    });
  }
};

const updateRecruitmentDrive = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      drive_name,
      institute_id,
      course_type,
      intake_capacity,
      eligibility_criteria,
      status
    } = req.body;

    const success = await recruitmentDriveDao.updateRecruitmentDrive(id, {
      drive_name,
      institute_id,
      course_type,
      intake_capacity,
      eligibility_criteria,
      status
    });

    if (!success) {
      return res.status(404).json({ message: 'Recruitment drive not found' });
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'UPDATE_RECRUITMENT_DRIVE',
        `Updated recruitment drive: ${id}`,
        req.ip || req.connection.remoteAddress
      );
    }

    res.json({ message: 'Recruitment drive updated successfully' });
  } catch (error) {
    console.error('Update Recruitment Drive Error:', error);
    res.status(500).json({
      message: 'Error updating recruitment drive',
      error: error.message
    });
  }
};

const deleteRecruitmentDrive = async (req, res) => {
  try {
    const { id } = req.params;

    const success = await recruitmentDriveDao.deleteRecruitmentDrive(id);

    if (!success) {
      return res.status(404).json({ message: 'Recruitment drive not found' });
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'DELETE_RECRUITMENT_DRIVE',
        `Deleted recruitment drive: ${id}`,
        req.ip || req.connection.remoteAddress
      );
    }

    res.json({ message: 'Recruitment drive deleted successfully' });
  } catch (error) {
    console.error('Delete Recruitment Drive Error:', error);
    res.status(500).json({
      message: 'Error deleting recruitment drive',
      error: error.message
    });
  }
};

const getRecruitmentDriveStats = async (req, res) => {
  try {
    const { id } = req.params;

    const stats = await recruitmentDriveDao.getRecruitmentDriveStats(id);

    res.json({ data: stats });
  } catch (error) {
    console.error('Get Recruitment Drive Stats Error:', error);
    res.status(500).json({
      message: 'Error fetching recruitment drive stats',
      error: error.message
    });
  }
};

module.exports = {
  createRecruitmentDrive,
  getAllRecruitmentDrives,
  getRecruitmentDriveById,
  updateRecruitmentDrive,
  deleteRecruitmentDrive,
  getRecruitmentDriveStats
};