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

module.exports = {
  createCadet,
  getAllCadets,
};
