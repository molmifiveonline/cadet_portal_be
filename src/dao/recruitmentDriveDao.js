const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createRecruitmentDrive = async (driveData) => {
  const {
    drive_name,
    institute_id,
    course_type,
    year,
    intake_capacity = 0,
    eligibility_criteria,
    status = 'Draft'
  } = driveData;

  const id = uuidv4();

  await db.query(
    `INSERT INTO recruitment_drives (id, drive_name, institute_id, course_type, year, intake_capacity, eligibility_criteria, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, drive_name, institute_id, course_type, year, intake_capacity, eligibility_criteria, status]
  );

  return id;
};

const getAllRecruitmentDrives = async (limit = 10, offset = 0, filters = {}) => {
  let query = `
    SELECT rd.*, i.institute_name,
      (SELECT COUNT(*)
       FROM cadets c
       WHERE c.drive_id = rd.id
      ) as total_cadets,
      (SELECT COUNT(*)
       FROM cadets c
       WHERE c.drive_id = rd.id
         AND c.status IN ('Eligible for Assessment', 'active', 'Imported')
      ) as uploaded_count,
      (SELECT COUNT(*)
       FROM cadets c
       WHERE c.drive_id = rd.id
         AND c.status = 'Assessment Completed'
      ) as assessment_completed_count,
      (SELECT COUNT(*)
       FROM cadets c
       WHERE c.drive_id = rd.id
         AND c.status IN ('Eligible for Interview', 'Interview Selected')
      ) as interview_ready_count,
      (SELECT COUNT(*)
       FROM cadets c
       WHERE c.drive_id = rd.id
         AND c.status = 'Eligible for Medical'
      ) as medical_ready_count,
      (SELECT COUNT(*)
       FROM cadets c
       WHERE c.drive_id = rd.id
         AND c.status = 'Medical Completed'
      ) as medical_completed_count,
      (SELECT COUNT(*)
       FROM cadets c
       WHERE c.drive_id = rd.id
         AND c.status = 'CTV Assigned'
      ) as ctv_assigned_count,
      (SELECT COUNT(*)
       FROM cadets c
       WHERE c.drive_id = rd.id
         AND c.status = 'Onboarded'
      ) as onboarded_count
    FROM recruitment_drives rd
    LEFT JOIN institutes i ON rd.institute_id = i.id
  `;
  let queryParams = [];
  let whereClauses = [];

  if (filters.institute_id) {
    whereClauses.push('rd.institute_id = ?');
    queryParams.push(filters.institute_id);
  }

  if (filters.course_type && filters.course_type !== 'all') {
    whereClauses.push('rd.course_type = ?');
    queryParams.push(filters.course_type);
  }

  if (filters.status && filters.status !== 'all') {
    whereClauses.push('rd.status = ?');
    queryParams.push(filters.status);
  }

  if (filters.search) {
    whereClauses.push('rd.drive_name LIKE ?');
    queryParams.push(`%${filters.search}%`);
  }

  if (whereClauses.length > 0) {
    query += ' WHERE ' + whereClauses.join(' AND ');
  }

  query += ' ORDER BY rd.created_at DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);

  let countQuery = 'SELECT COUNT(*) as total FROM recruitment_drives rd';
  let countParams = [];

  if (whereClauses.length > 0) {
    countQuery += ' WHERE ' + whereClauses.join(' AND ');
    countParams = queryParams.slice(0, queryParams.length - 2);
  }

  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data: rows, total };
};

const getRecruitmentDriveById = async (id) => {
  const [rows] = await db.query(
    `SELECT
      rd.*,
      i.institute_name,
      CASE
        WHEN i.temp_expiry IS NOT NULL
         AND i.batch_year = COALESCE(rd.year, YEAR(rd.created_at))
        THEN 1
        ELSE 0
      END AS institute_email_sent,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM institute_submissions isub
          WHERE isub.institute_id = rd.institute_id
            AND isub.batch_year = COALESCE(rd.year, YEAR(rd.created_at))
            AND isub.course_type = rd.course_type
        )
        THEN 1
        ELSE 0
      END AS institute_reverted_excel
     FROM recruitment_drives rd
     LEFT JOIN institutes i ON rd.institute_id = i.id
     WHERE rd.id = ?`,
    [id]
  );
  return rows[0];
};

const getDriveByContext = async (instituteId, year, courseType) => {
  const [rows] = await db.query(
    `SELECT id 
     FROM recruitment_drives 
     WHERE institute_id = ? 
       AND year = ? 
       AND ? LIKE CONCAT('%', course_type, '%')
     ORDER BY created_at DESC LIMIT 1`,
    [instituteId, year, courseType]
  );
  return rows[0] || null;
};

const getDriveByName = async (driveName, excludeId = null) => {
  let query = `
    SELECT id, drive_name
    FROM recruitment_drives
    WHERE LOWER(TRIM(drive_name)) = LOWER(TRIM(?))
  `;
  const params = [driveName];

  if (excludeId) {
    query += ' AND id <> ?';
    params.push(excludeId);
  }

  query += ' LIMIT 1';

  const [rows] = await db.query(query, params);
  return rows[0] || null;
};

const getDriveByInstituteYearCourseType = async (instituteId, year, courseType, excludeId = null) => {
  let query = `
    SELECT id, drive_name
    FROM recruitment_drives
    WHERE institute_id = ?
      AND year = ?
      AND course_type = ?
  `;
  const params = [instituteId, year, courseType];

  if (excludeId) {
    query += ' AND id <> ?';
    params.push(excludeId);
  }

  query += ' LIMIT 1';

  const [rows] = await db.query(query, params);
  return rows[0] || null;
};

const updateRecruitmentDrive = async (id, driveData) => {
  const {
    drive_name,
    institute_id,
    course_type,
    year,
    intake_capacity,
    eligibility_criteria,
    status
  } = driveData;

  const [result] = await db.query(
    `UPDATE recruitment_drives
     SET drive_name = COALESCE(?, drive_name),
         institute_id = COALESCE(?, institute_id),
         course_type = COALESCE(?, course_type),
         year = COALESCE(?, year),
         intake_capacity = COALESCE(?, intake_capacity),
         eligibility_criteria = COALESCE(?, eligibility_criteria),
         status = COALESCE(?, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [drive_name, institute_id, course_type, year, intake_capacity, eligibility_criteria, status, id]
  );

  return result.affectedRows > 0;
};

const deleteRecruitmentDrive = async (id) => {
  const [result] = await db.query('DELETE FROM recruitment_drives WHERE id = ?', [id]);
  return result.affectedRows > 0;
};

const getRecruitmentDriveStats = async (driveId) => {
  // Get pipeline counts strictly linked to this drive
  const [rows] = await db.query(`
    SELECT
      COUNT(*) as total_cadets,
      SUM(CASE WHEN status IN ('Eligible for Assessment', 'active', 'Imported') THEN 1 ELSE 0 END) as uploaded,
      SUM(CASE WHEN status IN ('Eligible for Assessment', 'active') THEN 1 ELSE 0 END) as shortlisted_cadets,
      SUM(CASE WHEN status = 'Assessment Completed' THEN 1 ELSE 0 END) as assessment_passed,
      SUM(CASE WHEN status = 'Eligible for Interview' OR status = 'Interview Selected' THEN 1 ELSE 0 END) as interview_ready,
      SUM(CASE WHEN status = 'Eligible for Medical' THEN 1 ELSE 0 END) as medical_ready,
      SUM(CASE WHEN status = 'Medical Completed' THEN 1 ELSE 0 END) as medical_completed,
      SUM(CASE WHEN status = 'CTV Assigned' THEN 1 ELSE 0 END) as ctv_assigned,
      SUM(CASE WHEN status = 'Onboarded' THEN 1 ELSE 0 END) as onboarded
    FROM cadets
    WHERE drive_id = ?
  `, [driveId]);

  return rows[0];
};

module.exports = {
  createRecruitmentDrive,
  getAllRecruitmentDrives,
  getRecruitmentDriveById,
  getDriveByContext,
  getDriveByName,
  getDriveByInstituteYearCourseType,
  updateRecruitmentDrive,
  deleteRecruitmentDrive,
  getRecruitmentDriveStats
};
