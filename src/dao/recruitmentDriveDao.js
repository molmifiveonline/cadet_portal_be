const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createRecruitmentDrive = async (driveData) => {
  const {
    drive_name,
    institute_id,
    course_type,
    intake_capacity = 0,
    eligibility_criteria,
    status = 'Draft'
  } = driveData;

  const id = uuidv4();

  await db.query(
    `INSERT INTO recruitment_drives (id, drive_name, institute_id, course_type, intake_capacity, eligibility_criteria, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, drive_name, institute_id, course_type, intake_capacity, eligibility_criteria, status]
  );

  return id;
};

const getAllRecruitmentDrives = async (limit = 10, offset = 0, filters = {}) => {
  let query = `
    SELECT rd.*, i.institute_name,
      (SELECT COUNT(*) FROM cadets c WHERE c.institute_id = rd.institute_id AND c.course LIKE CONCAT('%', rd.course_type, '%')) as total_cadets,
      (SELECT COUNT(*) FROM cadets c WHERE c.institute_id = rd.institute_id AND c.course LIKE CONCAT('%', rd.course_type, '%') AND c.status = 'Onboarded') as onboarded
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
    `SELECT rd.*, i.institute_name
     FROM recruitment_drives rd
     LEFT JOIN institutes i ON rd.institute_id = i.id
     WHERE rd.id = ?`,
    [id]
  );
  return rows[0];
};

const updateRecruitmentDrive = async (id, driveData) => {
  const {
    drive_name,
    institute_id,
    course_type,
    intake_capacity,
    eligibility_criteria,
    status
  } = driveData;

  const [result] = await db.query(
    `UPDATE recruitment_drives
     SET drive_name = COALESCE(?, drive_name),
         institute_id = COALESCE(?, institute_id),
         course_type = COALESCE(?, course_type),
         intake_capacity = COALESCE(?, intake_capacity),
         eligibility_criteria = COALESCE(?, eligibility_criteria),
         status = COALESCE(?, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [drive_name, institute_id, course_type, intake_capacity, eligibility_criteria, status, id]
  );

  return result.affectedRows > 0;
};

const deleteRecruitmentDrive = async (id) => {
  const [result] = await db.query('DELETE FROM recruitment_drives WHERE id = ?', [id]);
  return result.affectedRows > 0;
};

const getRecruitmentDriveStats = async (driveId) => {
  // First get the drive info to know the institute and course
  const [driveRows] = await db.query(
    'SELECT institute_id, course_type FROM recruitment_drives WHERE id = ?',
    [driveId]
  );
  
  if (driveRows.length === 0) return null;
  const { institute_id, course_type } = driveRows[0];

  // Get pipeline counts for the drive matches (Institute + Course)
  const [rows] = await db.query(`
    SELECT
      COUNT(*) as total_cadets,
      SUM(CASE WHEN status = 'Eligible for Assessment' THEN 1 ELSE 0 END) as uploaded,
      SUM(CASE WHEN status = 'Assessment Completed' THEN 1 ELSE 0 END) as assessment_passed,
      SUM(CASE WHEN status = 'Eligible for Interview' OR status = 'Interview Selected' THEN 1 ELSE 0 END) as interview_selected,
      SUM(CASE WHEN status = 'Medical Completed' THEN 1 ELSE 0 END) as medical_completed,
      SUM(CASE WHEN status = 'CTV Assigned' THEN 1 ELSE 0 END) as ctv_assigned,
      SUM(CASE WHEN status = 'Onboarded' THEN 1 ELSE 0 END) as onboarded
    FROM cadets
    WHERE institute_id = ? AND course LIKE ?
  `, [institute_id, `%${course_type}%`]);

  return rows[0];
};

module.exports = {
  createRecruitmentDrive,
  getAllRecruitmentDrives,
  getRecruitmentDriveById,
  updateRecruitmentDrive,
  deleteRecruitmentDrive,
  getRecruitmentDriveStats
};