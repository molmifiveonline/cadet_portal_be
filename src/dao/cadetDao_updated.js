const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createCadet = async (cadetData) => {
  const {
    institute_id,
    submission_id,
    course,
    name_as_in_indos_cert,
    gender,
    home_town_or_nearby_airport,
    passing_out_date,
    date_of_birth,
    age_when_passing_out,
    contact_number,
    email_id,
    address,
    batch_rank_out_of_72_cadets,
    no_of_arrears,
    tenth_std_board,
    tenth_std_pass_out_year,
    tenth_avg_percentage,
    tenth_std_maths,
    tenth_std_science,
    tenth_std_english,
    twelfth_std_board,
    twelfth_std_pass_out_year,
    twelfth_pcm_avg_percentage,
    twelfth_std_english,
    twelfth_std_physics,
    twelfth_std_chemistry,
    twelfth_std_maths,
    imu_rank,
    imu_avg_all_semester_percentage,
    imu_sem_1_percentage,
    imu_sem_2_percentage,
    imu_sem_3_percentage,
    imu_sem_4_percentage,
    imu_sem_5_percentage,
    imu_sem_6_percentage,
    imu_sem_7_percentage,
    imu_sem_8_percentage,
    weight_in_kgs,
    height_in_cms,
    bmi,
    any_extra_curricular_achievement,
    status,
    batch_year,
    photo_path,
    photo_data,
    photo_mime_type,
    photo_name,
    cv_form_status,
    cv_form_completed_at,
    passport_number,
    indos_number,
    cdc_number,
    blood_group,
    nationality,
    eye_color,
    eye_vision,
    language_known,
    waist_in_cm,
    covid_vaccination,
    covid_dose,
    medical_history,
    family_medical_history,
    permanent_address,
    father_occupation,
    mother_occupation,
    marine_relative,
    educational_loan,
    graduation_university,
    stcw_elementary_first_aid,
    stcw_security_training,
    stcw_personal_safety,
    stcw_petrol_tanker,
    stcw_fire_prevention,
    stcw_chemical_tanker,
    stcw_personal_survival,
    stcw_gas_tanker,
  } = cadetData;

  const id = uuidv4();

  await db.query(
    `INSERT INTO cadets (
      id, institute_id, submission_id, course, name_as_in_indos_cert, gender, home_town_or_nearby_airport, passing_out_date, date_of_birth, age_when_passing_out, contact_number, email_id, address, batch_rank_out_of_72_cadets, no_of_arrears, tenth_std_board, tenth_std_pass_out_year, tenth_avg_percentage, tenth_std_maths, tenth_std_science, tenth_std_english, twelfth_std_board, twelfth_std_pass_out_year, twelfth_pcm_avg_percentage, twelfth_std_english, twelfth_std_physics, twelfth_std_chemistry, twelfth_std_maths, imu_rank, imu_avg_all_semester_percentage, imu_sem_1_percentage, imu_sem_2_percentage, imu_sem_3_percentage, imu_sem_4_percentage, imu_sem_5_percentage, imu_sem_6_percentage, imu_sem_7_percentage, imu_sem_8_percentage, weight_in_kgs, height_in_cms, bmi, any_extra_curricular_achievement, status, batch_year, photo_path, photo_data, photo_mime_type, photo_name, cv_form_status, cv_form_completed_at, passport_number, indos_number, cdc_number, blood_group, nationality, eye_color, eye_vision, language_known, waist_in_cm, covid_vaccination, covid_dose, medical_history, family_medical_history, permanent_address, father_occupation, mother_occupation, marine_relative, educational_loan, graduation_university, stcw_elementary_first_aid, stcw_security_training, stcw_personal_safety, stcw_petrol_tanker, stcw_fire_prevention, stcw_chemical_tanker, stcw_personal_survival, stcw_gas_tanker
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      institute_id,
      submission_id,
      course,
      name_as_in_indos_cert,
      gender,
      home_town_or_nearby_airport,
      passing_out_date,
      date_of_birth,
      age_when_passing_out,
      contact_number,
      email_id,
      address,
      batch_rank_out_of_72_cadets,
      no_of_arrears,
      tenth_std_board,
      tenth_std_pass_out_year,
      tenth_avg_percentage,
      tenth_std_maths,
      tenth_std_science,
      tenth_std_english,
      twelfth_std_board,
      twelfth_std_pass_out_year,
      twelfth_pcm_avg_percentage,
      twelfth_std_english,
      twelfth_std_physics,
      twelfth_std_chemistry,
      twelfth_std_maths,
      imu_rank,
      imu_avg_all_semester_percentage,
      imu_sem_1_percentage,
      imu_sem_2_percentage,
      imu_sem_3_percentage,
      imu_sem_4_percentage,
      imu_sem_5_percentage,
      imu_sem_6_percentage,
      imu_sem_7_percentage,
      imu_sem_8_percentage,
      weight_in_kgs,
      height_in_cms,
      bmi,
      any_extra_curricular_achievement,
      status || 'active',
      batch_year || null,
      photo_path,
      photo_data,
      photo_mime_type,
      photo_name,
      cv_form_status,
      cv_form_completed_at,
      passport_number,
      indos_number,
      cdc_number,
      blood_group,
      nationality,
      eye_color,
      eye_vision,
      language_known,
      waist_in_cm,
      covid_vaccination,
      covid_dose,
      medical_history,
      family_medical_history,
      permanent_address,
      father_occupation,
      mother_occupation,
      marine_relative,
      educational_loan,
      graduation_university,
      stcw_elementary_first_aid,
      stcw_security_training,
      stcw_personal_safety,
      stcw_petrol_tanker,
      stcw_fire_prevention,
      stcw_chemical_tanker,
      stcw_personal_survival,
      stcw_gas_tanker,
    ],
  );
  return id;
};

const getAllCadets = async (limit = 10, offset = 0, filters = {}) => {
  let query = `
    SELECT c.id, c.institute_id, c.submission_id, c.course, c.name_as_in_indos_cert, c.gender, c.home_town_or_nearby_airport, c.passing_out_date, c.date_of_birth, c.age_when_passing_out, c.contact_number, c.email_id, c.batch_rank_out_of_72_cadets, c.no_of_arrears, c.tenth_std_board, c.tenth_std_pass_out_year, c.tenth_avg_percentage, c.tenth_std_maths, c.tenth_std_science, c.tenth_std_english, c.twelfth_std_board, c.twelfth_std_pass_out_year, c.twelfth_pcm_avg_percentage, c.twelfth_std_english, c.twelfth_std_physics, c.twelfth_std_chemistry, c.twelfth_std_maths, c.imu_rank, c.imu_avg_all_semester_percentage, c.imu_sem_1_percentage, c.imu_sem_2_percentage, c.imu_sem_3_percentage, c.imu_sem_4_percentage, c.imu_sem_5_percentage, c.imu_sem_6_percentage, c.imu_sem_7_percentage, c.imu_sem_8_percentage, c.weight_in_kgs, c.height_in_cms, c.bmi, c.any_extra_curricular_achievement, c.status, c.created_at, c.batch_year, c.photo_path, c.photo_data, c.photo_mime_type, c.photo_name, c.cv_form_status, c.cv_form_completed_at, c.passport_number, c.indos_number, c.cdc_number, c.blood_group, c.nationality, c.eye_color, c.eye_vision, c.language_known, c.waist_in_cm, c.covid_vaccination, c.covid_dose, c.medical_history, c.family_medical_history, c.permanent_address, c.address, c.father_occupation, c.mother_occupation, c.marine_relative, c.educational_loan, c.graduation_university, c.stcw_elementary_first_aid, c.stcw_security_training, c.stcw_personal_safety, c.stcw_petrol_tanker, c.stcw_fire_prevention, c.stcw_chemical_tanker, c.stcw_personal_survival, c.stcw_gas_tanker
    FROM cadets c
    ORDER BY c.created_at DESC
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
    'institute_id',
    'submission_id',
    'course',
    'name_as_in_indos_cert',
    'gender',
    'home_town_or_nearby_airport',
    'passing_out_date',
    'date_of_birth',
    'age_when_passing_out',
    'contact_number',
    'email_id',
    'address',
    'batch_rank_out_of_72_cadets',
    'no_of_arrears',
    'tenth_std_board',
    'tenth_std_pass_out_year',
    'tenth_avg_percentage',
    'tenth_std_maths',
    'tenth_std_science',
    'tenth_std_english',
    'twelfth_std_board',
    'twelfth_std_pass_out_year',
    'twelfth_pcm_avg_percentage',
    'twelfth_std_english',
    'twelfth_std_physics',
    'twelfth_std_chemistry',
    'twelfth_std_maths',
    'imu_rank',
    'imu_avg_all_semester_percentage',
    'imu_sem_1_percentage',
    'imu_sem_2_percentage',
    'imu_sem_3_percentage',
    'imu_sem_4_percentage',
    'imu_sem_5_percentage',
    'imu_sem_6_percentage',
    'imu_sem_7_percentage',
    'imu_sem_8_percentage',
    'weight_in_kgs',
    'height_in_cms',
    'bmi',
    'any_extra_curricular_achievement',
    'status',
    'batch_year',
    'photo_path',
    'cv_form_status',
    'cv_form_completed_at',
    'passport_number',
    'indos_number',
    'cdc_number',
    'blood_group',
    'nationality',
    'eye_color',
    'eye_vision',
    'language_known',
    'waist_in_cm',
    'covid_vaccination',
    'covid_dose',
    'medical_history',
    'family_medical_history',
    'permanent_address',
    'father_occupation',
    'mother_occupation',
    'marine_relative',
    'educational_loan',
    'graduation_university',
    'stcw_elementary_first_aid',
    'stcw_security_training',
    'stcw_personal_safety',
    'stcw_petrol_tanker',
    'stcw_fire_prevention',
    'stcw_chemical_tanker',
    'stcw_personal_survival',
    'stcw_gas_tanker',
  ];

  // Build dynamic UPDATE query
  for (const field of allowedFields) {
    if (cvData[field] !== undefined) {
      updateFields.push(`${field} = ?`);
      values.push(cvData[field]);
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
    'submission_id',
    'course',
    'name_as_in_indos_cert',
    'gender',
    'home_town_or_nearby_airport',
    'passing_out_date',
    'date_of_birth',
    'age_when_passing_out',
    'contact_number',
    'email_id',
    'address',
    'batch_rank_out_of_72_cadets',
    'no_of_arrears',
    'tenth_std_board',
    'tenth_std_pass_out_year',
    'tenth_avg_percentage',
    'tenth_std_maths',
    'tenth_std_science',
    'tenth_std_english',
    'twelfth_std_board',
    'twelfth_std_pass_out_year',
    'twelfth_pcm_avg_percentage',
    'twelfth_std_english',
    'twelfth_std_physics',
    'twelfth_std_chemistry',
    'twelfth_std_maths',
    'imu_rank',
    'imu_avg_all_semester_percentage',
    'imu_sem_1_percentage',
    'imu_sem_2_percentage',
    'imu_sem_3_percentage',
    'imu_sem_4_percentage',
    'imu_sem_5_percentage',
    'imu_sem_6_percentage',
    'imu_sem_7_percentage',
    'imu_sem_8_percentage',
    'weight_in_kgs',
    'height_in_cms',
    'bmi',
    'any_extra_curricular_achievement',
    'status',
    'batch_year',
    'photo_path',
    'cv_form_status',
    'cv_form_completed_at',
    'passport_number',
    'indos_number',
    'cdc_number',
    'blood_group',
    'nationality',
    'eye_color',
    'eye_vision',
    'language_known',
    'waist_in_cm',
    'covid_vaccination',
    'covid_dose',
    'medical_history',
    'family_medical_history',
    'permanent_address',
    'father_occupation',
    'mother_occupation',
    'marine_relative',
    'educational_loan',
    'graduation_university',
    'stcw_elementary_first_aid',
    'stcw_security_training',
    'stcw_personal_safety',
    'stcw_petrol_tanker',
    'stcw_fire_prevention',
    'stcw_chemical_tanker',
    'stcw_personal_survival',
    'stcw_gas_tanker',
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
