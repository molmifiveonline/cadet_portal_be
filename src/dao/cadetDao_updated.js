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
      bmi, extra_curricular, status, batch_year
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      cadetData.batch_year || null,
    ],
  );
  return id;
};

const getAllCadets = async (limit = 10, offset = 0, filters = {}) => {
  let query = `
    SELECT c.id, c.institute_id, c.submission_id, c.course, c.name_as_in_indos_cert, c.gender, c.home_town_or_nearby_airport, c.passing_out_date, c.date_of_birth, c.age_when_passing_out, c.contact_number, c.email_id, c.batch_rank_out_of_72_cadets, c.no_of_arrears, c.tenth_std_board, c.tenth_std_pass_out_year, c.tenth_avg_percentage, c.tenth_std_maths, c.tenth_std_science, c.tenth_std_english, c.twelfth_std_board, c.twelfth_std_pass_out_year, c.twelfth_pcm_avg_percentage, c.twelfth_std_english, c.twelfth_std_physics, c.twelfth_std_chemistry, c.twelfth_std_maths, c.imu_rank, c.imu_avg_all_semester_percentage, c.imu_sem_1_percentage, c.imu_sem_2_percentage, c.imu_sem_3_percentage, c.imu_sem_4_percentage, c.imu_sem_5_percentage, c.imu_sem_6_percentage, c.imu_sem_7_percentage, c.imu_sem_8_percentage, c.weight_in_kgs, c.height_in_cms, c.bmi, c.any_extra_curricular_achievement, c.batch, c.status, c.created_at, c.batch_year, c.photo_path, c.photo_data, c.photo_mime_type, c.photo_name, c.cv_form_status, c.cv_form_completed_at, c.passport_number, c.indos_number, c.cdc_number, c.blood_group, c.nationality, c.eye_color, c.eye_vision, c.language_known, c.waist_in_cm, c.covid_vaccination, c.covid_dose, c.medical_history, c.family_medical_history, c.permanent_address, c.post_applied_for, c.father_occupation, c.mother_occupation, c.sibling_occupation, c.marine_relative, c.educational_loan, c.graduation_course, c.graduation_university, c.degree_percentage, c.stcw_courses, i.institute_name
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

/**
 * Update cadet data
 * @param {string} id - Cadet ID
 * @param {Object} cadetData - Data to update
 */
const updateCadet = async (id, cadetData) => {
  const allowedFields = [
    'institute_id',
    'name',
    'email',
    'phone',
    'course',
    'batch',
    'gender',
    'dob',
    'indos_number',
    'cdc_number',
    'passport_number',
    'tenth_percentage',
    'twelfth_percentage',
    'pcm_percentage',
    'degree_percentage',
    'height',
    'weight',
    'blood_group',
    'hometown',
    'passing_out_date',
    'age_at_passing_out',
    'batch_rank',
    'no_of_arrears',
    'tenth_board',
    'tenth_year',
    'tenth_maths',
    'tenth_science',
    'tenth_english',
    'twelfth_board',
    'twelfth_year',
    'twelfth_english',
    'twelfth_physics',
    'twelfth_chemistry',
    'twelfth_maths',
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
    'bmi',
    'extra_curricular',
    'status',
    'photo_path',
  ];

  const updateFields = [];
  const values = [];

  for (const field of allowedFields) {
    if (cadetData[field] !== undefined) {
      updateFields.push(`${field} = ?`);
      values.push(cadetData[field]);
    }
  }

  if (updateFields.length === 0) {
    return; // Nothing to update
  }

  values.push(id);

  const query = `UPDATE cadets SET ${updateFields.join(', ')} WHERE id = ?`;
  await db.query(query, values);
};

const saveCadetPhoto = async (cadetId, photoBuffer, mimeType, photoName) => {
  await db.query(
    'UPDATE cadets SET photo_data = ?, photo_mime_type = ?, photo_name = ? WHERE id = ?',
    [photoBuffer, mimeType, photoName, cadetId],
  );
};

const getCadetPhoto = async (cadetId) => {
  const [rows] = await db.query(
    'SELECT photo_data, photo_mime_type FROM cadets WHERE id = ?',
    [cadetId],
  );
  if (rows.length === 0 || !rows[0].photo_data) return null;
  return rows[0];
};

const deleteCadet = async (id) => {
  await db.query('DELETE FROM cadets WHERE id = ?', [id]);
};

module.exports = {
  createCadet,
  getAllCadets,
  getCadetById,
  getShortlistedCadets,
  getShortlistCountByInstitute,
  updateCVData,
  updateCadet,
  saveCadetPhoto,
  getCadetPhoto,
  deleteCadet,
};
