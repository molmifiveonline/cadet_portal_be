const recruitmentDriveDao = require('../dao/recruitmentDriveDao');
const activityLogDao = require('../dao/activityLogDao');
const instituteDao = require('../dao/instituteDao');
const { DEFAULT_PAGE_SIZE, ROLES, DRIVE_STATUS, SUBMISSION_STATUS } = require('../config/constants');
const { processImport } = require('./instituteSubmissionController');

const createRecruitmentDrive = async (req, res) => {
  try {
    const {
      drive_name,
      institute_id,
      course_type,
      year,
      intake_capacity,
      eligibility_criteria,
      status
    } = req.body;

    if (!drive_name || !institute_id || !course_type) {
      return res.status(400).json({ message: 'Required fields are missing' });
    }

    const parsedYear = year === undefined || year === null || year === ''
      ? new Date().getFullYear()
      : parseInt(year, 10);

    if (Number.isNaN(parsedYear)) {
      return res.status(400).json({ message: 'Year must be a valid number' });
    }

    const duplicateByName = await recruitmentDriveDao.getDriveByName(drive_name);
    if (duplicateByName) {
      return res.status(409).json({ message: 'Recruitment drive name already exists' });
    }

    const duplicateByContext = await recruitmentDriveDao.getDriveByInstituteYearCourseType(
      institute_id,
      parsedYear,
      course_type
    );
    if (duplicateByContext) {
      return res.status(409).json({
        message: 'A recruitment drive already exists for this institute, year, and course type'
      });
    }

    const id = await recruitmentDriveDao.createRecruitmentDrive({
      drive_name,
      institute_id,
      course_type,
      year: parsedYear,
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
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'A recruitment drive already exists for this institute, year, and course type'
      });
    }
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
    let institute_id = req.query.institute_id;
    const course_type = req.query.course_type;
    const status = req.query.status;

    if (req.user && req.user.role === 'Institute') {
      institute_id = req.user.id;
    }

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
    let drive = await recruitmentDriveDao.getRecruitmentDriveById(id);

    if (!drive) {
      return res.status(404).json({ message: 'Recruitment drive not found' });
    }

    // Self-healing: Sync status if it's lagging behind actual data flags
    let needsUpdate = false;
    let newStatus = drive.status;

    if (drive.status === DRIVE_STATUS.DRAFT || drive.status === DRIVE_STATUS.REQUESTED) {
      if (Number(drive.institute_reverted_excel)) {
        newStatus = DRIVE_STATUS.RECEIVED;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await recruitmentDriveDao.updateRecruitmentDrive(id, { status: newStatus });
      // Re-fetch to get updated state (including updated_at etc)
      drive = await recruitmentDriveDao.getRecruitmentDriveById(id);
    }

    if (req.user && req.user.role === 'Institute' && drive.institute_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied to this recruitment drive' });
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
      year,
      intake_capacity,
      eligibility_criteria,
      status
    } = req.body;

    let parsedYear;
    if (year !== undefined && year !== null && year !== '') {
      parsedYear = parseInt(year, 10);
      if (Number.isNaN(parsedYear)) {
        return res.status(400).json({ message: 'Year must be a valid number' });
      }
    }

    const existingDrive = await recruitmentDriveDao.getRecruitmentDriveById(id);
    if (!existingDrive) {
      return res.status(404).json({ message: 'Recruitment drive not found' });
    }

    const resolvedDriveName = drive_name ?? existingDrive.drive_name;
    const resolvedInstituteId = institute_id ?? existingDrive.institute_id;
    const resolvedCourseType = course_type ?? existingDrive.course_type;
    const resolvedYear = parsedYear ?? existingDrive.year;

    if (resolvedDriveName) {
      const duplicateByName = await recruitmentDriveDao.getDriveByName(resolvedDriveName, id);
      if (duplicateByName) {
        return res.status(409).json({ message: 'Recruitment drive name already exists' });
      }
    }

    const duplicateByContext = await recruitmentDriveDao.getDriveByInstituteYearCourseType(
      resolvedInstituteId,
      resolvedYear,
      resolvedCourseType,
      id
    );
    if (duplicateByContext) {
      return res.status(409).json({
        message: 'A recruitment drive already exists for this institute, year, and course type'
      });
    }

    const success = await recruitmentDriveDao.updateRecruitmentDrive(id, {
      drive_name,
      institute_id,
      course_type,
      year: parsedYear,
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
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'A recruitment drive already exists for this institute, year, and course type'
      });
    }
    res.status(500).json({
      message: 'Error updating recruitment drive',
      error: error.message
    });
  }
};

const deleteRecruitmentDrive = async (req, res) => {
  try {
    if (req.user && req.user.role === ROLES.INSTITUTE) {
      return res.status(403).json({
        message: 'Institute users are not allowed to delete recruitment drives',
      });
    }

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

const submitCadetDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const drive = await recruitmentDriveDao.getRecruitmentDriveById(id);
    if (!drive) {
      return res.status(404).json({ message: 'Recruitment drive not found' });
    }

    // Find the latest pending/uploaded submission for this drive
    const { data: submissions } = await instituteDao.getAllSubmissions(
      1,
      0,
      SUBMISSION_STATUS.UPLOADED,
      '',
      drive.institute_id,
      drive.year,
      drive.course_type
    );

    if (!submissions || submissions.length === 0) {
      return res.status(400).json({
        message: 'No pending submissions found for this institute and drive details. Please ask institute to upload first.'
      });
    }

    const latestSubmission = submissions[0];

    // Import cadets
    const stats = await processImport(
      latestSubmission.id,
      req.user?.id,
      req.ip || req.connection.remoteAddress,
      id // drive_id
    );

    // Update drive status
    await recruitmentDriveDao.updateRecruitmentDrive(id, {
      status: DRIVE_STATUS.SUBMITTED
    });

    res.json({
      success: true,
      message: 'Cadets submitted successfully to the drive',
      stats
    });
  } catch (error) {
    console.error('Submit Cadet Details Error:', error);
    res.status(500).json({
      message: 'Error submitting cadets',
      error: error.message
    });
  }
};

const finalizeShortlist = async (req, res) => {
  try {
    const { id } = req.params;
    await recruitmentDriveDao.updateRecruitmentDrive(id, { status: DRIVE_STATUS.SHORTLISTED });
    res.json({ success: true, message: 'Shortlist finalized successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error finalizing shortlist', error: error.message });
  }
};

const finalizeAssessment = async (req, res) => {
  try {
    const { id } = req.params;
    await recruitmentDriveDao.updateRecruitmentDrive(id, { status: DRIVE_STATUS.ASSESSMENT_COMPLETED });
    res.json({ success: true, message: 'Assessment finalized successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error finalizing assessment', error: error.message });
  }
};

const finalizeInterview = async (req, res) => {
  try {
    const { id } = req.params;
    await recruitmentDriveDao.updateRecruitmentDrive(id, { status: DRIVE_STATUS.INTERVIEW_COMPLETED });
    res.json({ success: true, message: 'Interview finalized successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error finalizing interview', error: error.message });
  }
};

const finalizeMedical = async (req, res) => {
  try {
    const { id } = req.params;
    await recruitmentDriveDao.updateRecruitmentDrive(id, { status: DRIVE_STATUS.MEDICAL_COMPLETED });
    res.json({ success: true, message: 'Medical stage finalized successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error finalizing medical', error: error.message });
  }
};

const closeDrive = async (req, res) => {
  try {
    const { id } = req.params;
    await recruitmentDriveDao.updateRecruitmentDrive(id, { status: DRIVE_STATUS.CLOSED });
    res.json({ success: true, message: 'Drive closed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error closing drive', error: error.message });
  }
};

module.exports = {
  createRecruitmentDrive,
  getAllRecruitmentDrives,
  getRecruitmentDriveById,
  updateRecruitmentDrive,
  deleteRecruitmentDrive,
  getRecruitmentDriveStats,
  submitCadetDetails,
  finalizeShortlist,
  finalizeAssessment,
  finalizeInterview,
  finalizeMedical,
  closeDrive
};
