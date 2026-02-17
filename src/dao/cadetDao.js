const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createCadet = async (cadetData) => {
  const {
    institute_id,
    submission_id,
    name,
    email,
    phone,
    course,
    batch,
    gender,
    dob,
    indos_number,
    cdc_number,
    passport_number,
    tenth_percentage,
    twelfth_percentage,
    pcm_percentage,
    degree_percentage,
    height,
    weight,
    blood_group,
    hometown,
    passing_out_date,
    age_at_passing_out,
    batch_rank,
    no_of_arrears,
    tenth_board,
    tenth_year,
    tenth_maths,
    tenth_science,
    tenth_english,
    twelfth_board,
    twelfth_year,
    twelfth_english,
    twelfth_physics,
    twelfth_chemistry,
    twelfth_maths,
    imu_rank,
    imu_avg_percentage,
    imu_sem1,
    imu_sem2,
    imu_sem3,
    imu_sem4,
    imu_sem5,
    imu_sem6,
    imu_sem7,
    imu_sem8,
    bmi,
    extra_curricular,
    status,
  } = cadetData;

  const id = uuidv4();

  await db.query(
    `INSERT INTO cadets (
      id, institute_id, submission_id, name, email, phone, course, batch, 
      gender, dob, indos_number, cdc_number, passport_number, 
      tenth_percentage, twelfth_percentage, pcm_percentage, degree_percentage, 
      height, weight, blood_group,
      hometown, passing_out_date, age_at_passing_out, batch_rank, no_of_arrears,
      tenth_board, tenth_year, tenth_maths, tenth_science, tenth_english,
      twelfth_board, twelfth_year, twelfth_english, twelfth_physics, twelfth_chemistry, twelfth_maths,
      imu_rank, imu_avg_percentage, imu_sem1, imu_sem2, imu_sem3, imu_sem4, imu_sem5, imu_sem6, imu_sem7, imu_sem8,
      bmi, extra_curricular, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      institute_id,
      submission_id,
      name,
      email,
      phone,
      course,
      batch,
      gender,
      dob,
      indos_number,
      cdc_number,
      passport_number,
      tenth_percentage,
      twelfth_percentage,
      pcm_percentage,
      degree_percentage,
      height,
      weight,
      blood_group,
      hometown,
      passing_out_date,
      age_at_passing_out,
      batch_rank,
      no_of_arrears,
      tenth_board,
      tenth_year,
      tenth_maths,
      tenth_science,
      tenth_english,
      twelfth_board,
      twelfth_year,
      twelfth_english,
      twelfth_physics,
      twelfth_chemistry,
      twelfth_maths,
      imu_rank,
      imu_avg_percentage,
      imu_sem1,
      imu_sem2,
      imu_sem3,
      imu_sem4,
      imu_sem5,
      imu_sem6,
      imu_sem7,
      imu_sem8,
      bmi,
      extra_curricular,
      status || 'active',
    ],
  );
  return id;
};

const getAllCadets = async (limit = 10, offset = 0, filters = {}) => {
  let query = `
    SELECT c.*, i.institute_name 
    FROM cadets c
    LEFT JOIN institutes i ON c.institute_id = i.id
  `;
  let queryParams = [];
  let whereClauses = [];

  if (filters.instituteId) {
    whereClauses.push('c.institute_id = ?');
    queryParams.push(filters.instituteId);
  }

  if (filters.batch) {
    whereClauses.push('c.batch LIKE ?');
    queryParams.push(`%${filters.batch}%`);
  }

  if (filters.search) {
    whereClauses.push('(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)');
    const searchTerm = `%${filters.search}%`;
    queryParams.push(searchTerm, searchTerm, searchTerm);
  }

  if (whereClauses.length > 0) {
    query += ' WHERE ' + whereClauses.join(' AND ');
  }

  query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);

  let countQuery = 'SELECT COUNT(*) as total FROM cadets c';
  let countParams = [];

  if (whereClauses.length > 0) {
    countQuery += ' WHERE ' + whereClauses.join(' AND ');
    // Re-use parameters except limit/offset
    countParams = queryParams.slice(0, queryParams.length - 2);
  }

  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data: rows, total };
};

const getCadetById = async (id) => {
  const query = `
    SELECT c.*, i.institute_name 
    FROM cadets c
    LEFT JOIN institutes i ON c.institute_id = i.id
    WHERE c.id = ?
  `;
  const [rows] = await db.query(query, [id]);
  return rows[0];
};

/**
 * Get all cadets who meet shortlisting criteria
 * Criteria: 10th >= 85%, 10th subjects >= 80%, 12th >= 80%,
 *          12th subjects >= 75%, IMU rank <= 3000, BMI < 25
 */
const getShortlistedCadets = async (limit = 10, offset = 0, filters = {}) => {
  let query = `
    SELECT c.*, i.institute_name 
    FROM cadets c
    LEFT JOIN institutes i ON c.institute_id = i.id
    WHERE c.tenth_percentage >= 85
      AND c.tenth_maths >= 80
      AND c.tenth_science >= 80
      AND c.tenth_english >= 80
      AND c.twelfth_percentage >= 80
      AND c.twelfth_english >= 75
      AND c.twelfth_physics >= 75
      AND c.twelfth_chemistry >= 75
      AND c.twelfth_maths >= 75
      AND c.imu_rank <= 3000
      AND c.bmi < 25
  `;
  let queryParams = [];
  let additionalClauses = [];

  if (filters.instituteId) {
    additionalClauses.push('c.institute_id = ?');
    queryParams.push(filters.instituteId);
  }

  if (filters.search) {
    additionalClauses.push(
      '(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)',
    );
    const searchTerm = `%${filters.search}%`;
    queryParams.push(searchTerm, searchTerm, searchTerm);
  }

  if (additionalClauses.length > 0) {
    query += ' AND ' + additionalClauses.join(' AND ');
  }

  query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);

  // Count query
  let countQuery = `
    SELECT COUNT(*) as total 
    FROM cadets c
    WHERE c.tenth_percentage >= 85
      AND c.tenth_maths >= 80
      AND c.tenth_science >= 80
      AND c.tenth_english >= 80
      AND c.twelfth_percentage >= 80
      AND c.twelfth_english >= 75
      AND c.twelfth_physics >= 75
      AND c.twelfth_chemistry >= 75
      AND c.twelfth_maths >= 75
      AND c.imu_rank <= 3000
      AND c.bmi < 25
  `;
  let countParams = [];

  if (additionalClauses.length > 0) {
    countQuery += ' AND ' + additionalClauses.join(' AND ');
    countParams = queryParams.slice(0, queryParams.length - 2);
  }

  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data: rows, total };
};

/**
 * Get count of shortlisted cadets grouped by institute
 */
const getShortlistCountByInstitute = async () => {
  const query = `
    SELECT 
      i.id as institute_id,
      i.institute_name,
      COUNT(c.id) as count
    FROM institutes i
    LEFT JOIN cadets c ON i.id = c.institute_id
      AND c.tenth_percentage >= 85
      AND c.tenth_maths >= 80
      AND c.tenth_science >= 80
      AND c.tenth_english >= 80
      AND c.twelfth_percentage >= 80
      AND c.twelfth_english >= 75
      AND c.twelfth_physics >= 75
      AND c.twelfth_chemistry >= 75
      AND c.twelfth_maths >= 75
      AND c.imu_rank <= 3000
      AND c.bmi < 25
    GROUP BY i.id, i.institute_name
    HAVING count > 0
    ORDER BY count DESC
  `;

  const [rows] = await db.query(query);
  return rows;
};

/**
 * Update cadet CV form data
 * @param {string} cadetId - Cadet ID
 * @param {Object} cvData - CV form data to update
 */
const updateCVData = async (cadetId, cvData) => {
  const updateFields = [];
  const values = [];

  // Map of allowed CV form fields (matching actual database schema)
  const allowedFields = [
    // Existing fields that can be updated
    'passport_number', // Note: DB has passport_number, not passport_no
    'indos_number', // Should store actual INDOS numbers
    'hometown', // Using existing hometown field (same as place_of_birth)
    'nationality',
    'eye_color',
    'eye_vision',
    'language_known',
    'height',
    'weight',
    'waist_in_cm',
    'bmi',
    'blood_group',
    'covid_vaccination',
    'covid_dose',
    'medical_history',
    'family_medical_history',
    'permanent_address',
    'post_applied_for',
    // Academic fields - using existing names
    'tenth_percentage',
    'tenth_maths',
    'tenth_science',
    'tenth_english',
    'tenth_board',
    'tenth_year',
    'twelfth_percentage', // This is the overall 12th percentage (pcm_percentage also exists)
    'pcm_percentage', // Physics, Chemistry, Math average
    'twelfth_english',
    'twelfth_physics',
    'twelfth_chemistry',
    'twelfth_maths',
    'twelfth_board',
    'twelfth_year',
    'degree_percentage',
    'graduation_course',
    'graduation_university',
    // IMU semester marks - using existing fields
    'imu_rank',
    'imu_avg_percentage',
    'imu_sem1',
    'imu_sem2',
    'imu_sem3',
    'imu_sem4',
    'imu_sem5',
    'imu_sem6',
    'imu_sem7',
    'imu_sem8',
    // Family details
    'father_occupation',
    'mother_occupation',
    'sibling_occupation',
    // Marine and loan
    'marine_relative',
    'educational_loan',
    // STCW courses (JSON)
    'stcw_courses',
    // Photo
    'photo_path',
  ];

  // Build dynamic UPDATE query
  for (const field of allowedFields) {
    if (cvData[field] !== undefined) {
      updateFields.push(`${field} = ?`);
      // Handle JSON fields
      if (field === 'stcw_courses') {
        values.push(JSON.stringify(cvData[field]));
      } else {
        values.push(cvData[field]);
      }
    }
  }

  if (updateFields.length === 0) {
    throw new Error('No valid fields to update');
  }

  // Update cv_form_status
  updateFields.push('cv_form_status = ?');
  updateFields.push('cv_form_completed_at = NOW()');
  values.push('complete');

  values.push(cadetId);

  const query = `
    UPDATE cadets 
    SET ${updateFields.join(', ')}
    WHERE id = ?
  `;

  await db.query(query, values);
};

module.exports = {
  createCadet,
  getAllCadets,
  getCadetById,
  getShortlistedCadets,
  getShortlistCountByInstitute,
  updateCVData,
};
