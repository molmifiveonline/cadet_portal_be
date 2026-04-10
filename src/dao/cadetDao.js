const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const generateUniqueCadetId = async () => {
  const currentYear = new Date().getFullYear();
  const query = 'SELECT MAX(SUBSTRING_INDEX(cadet_unique_id, "-", -1)) as lastNum FROM cadets WHERE cadet_unique_id LIKE ?';
  const [rows] = await db.query(query, [`${currentYear}-%`]);
  
  const lastNum = rows[0].lastNum ? parseInt(rows[0].lastNum) : 0;
  const nextNum = String(lastNum + 1).padStart(4, '0');
  return `${currentYear}-${nextNum}`;
};

const createCadet = async (cadetData) => {
  const id = uuidv4();
  const cadetUniqueId = await generateUniqueCadetId();
  
  const finalData = {
    ...cadetData,
    id,
    cadet_unique_id: cadetUniqueId
  };

  const fields = Object.keys(finalData);
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map((f) => finalData[f]);

  await db.query(
    `INSERT INTO cadets (${fields.join(', ')}) VALUES (${placeholders})`,
    values,
  );
  return id;
};

const findDuplicateCadet = async (cadetData = {}) => {
  const instituteId = cadetData.institute_id;
  const batchYear = cadetData.batch_year;
  const name = cadetData.name_as_in_indos_cert;
  const course = cadetData.course;

  if (!instituteId || !batchYear || !name || !course) {
    return null;
  }

  let query = `
    SELECT id
    FROM cadets
    WHERE institute_id = ?
      AND batch_year = ?
      AND LOWER(TRIM(name_as_in_indos_cert)) = LOWER(TRIM(?))
      AND LOWER(TRIM(course)) = LOWER(TRIM(?))
  `;
  const params = [instituteId, batchYear, name, course];
  const identityClauses = [];

  if (cadetData.date_of_birth) {
    identityClauses.push('date_of_birth = ?');
    params.push(cadetData.date_of_birth);
  }

  if (cadetData.email_id) {
    identityClauses.push('LOWER(TRIM(email_id)) = LOWER(TRIM(?))');
    params.push(cadetData.email_id);
  }

  if (cadetData.contact_number) {
    identityClauses.push(
      "REPLACE(REPLACE(TRIM(contact_number), ' ', ''), '-', '') = REPLACE(REPLACE(TRIM(?), ' ', ''), '-', '')",
    );
    params.push(cadetData.contact_number);
  }

  if (identityClauses.length > 0) {
    query += ` AND (${identityClauses.join(' OR ')})`;
  }

  query += ' LIMIT 1';
  const [rows] = await db.query(query, params);
  return rows[0] || null;
};

const getAllCadets = async (limit = 10, offset = 0, filters = {}) => {
  let query = `
    SELECT c.*, i.institute_name,
           a.ces_test, a.ces_test_2, a.qa_test, a.english_test, a.essay_writing_mark, a.calculated_score, a.remarks as assessment_remarks, a.mark_for_interview,
           iv.interview_date, iv.panel_members, iv.evaluation_score, iv.total_score, iv.final_decision, iv.remarks as interview_remarks,
           mr.appointment_date as medical_date, mr.appointment_time as medical_time, mr.status as fit_status, mr.remarks as medical_remarks, mc.center_name as medical_center_name
    FROM cadets c
    LEFT JOIN institutes i ON c.institute_id = i.id
    LEFT JOIN assessments a ON c.id = a.cadet_id
    LEFT JOIN interviews iv ON c.id = iv.cadet_id
    LEFT JOIN cadet_medical_results mr ON c.id = mr.cadet_id
    LEFT JOIN medical_centers mc ON mr.medical_center_id = mc.id
  `;
  let queryParams = [];
  let whereClauses = [];

  if (filters.batch_year && filters.batch_year !== 'all') {
    whereClauses.push('c.batch_year = ?');
    queryParams.push(filters.batch_year);
  }

  if (filters.instituteId) {
    whereClauses.push('c.institute_id = ?');
    queryParams.push(filters.instituteId);
  }

  if (filters.drive_id) {
    whereClauses.push('c.drive_id = ?');
    queryParams.push(filters.drive_id);
  }

  if (filters.course_type && filters.course_type !== 'all') {
    whereClauses.push('c.course LIKE ?');
    queryParams.push(`%${filters.course_type}%`);
  }

  if (filters.batch) {
    whereClauses.push('c.batch LIKE ?');
    queryParams.push(`%${filters.batch}%`);
  }

  if (filters.status && filters.status !== 'all') {
    if (filters.status === 'Imported') {
      whereClauses.push("c.status IN ('Imported', 'Eligible for Assessment', 'active')");
    } else if (filters.status === 'Eligible for Assessment') {
      whereClauses.push("c.status IN ('Eligible for Assessment', 'active')");
    } else {
      whereClauses.push('c.status = ?');
      queryParams.push(filters.status);
    }
  }

  if (filters.search) {
    whereClauses.push(
      '(c.name_as_in_indos_cert LIKE ? OR c.email_id LIKE ? OR c.contact_number LIKE ?)',
    );
    const searchTerm = `%${filters.search}%`;
    queryParams.push(searchTerm, searchTerm, searchTerm);
  }

  if (whereClauses.length > 0) {
    query += ' WHERE ' + whereClauses.join(' AND ');
  }

  query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);

  let countQuery = 'SELECT COUNT(*) as total FROM cadets c LEFT JOIN institutes i ON c.institute_id = i.id LEFT JOIN assessments a ON c.id = a.cadet_id LEFT JOIN interviews iv ON c.id = iv.cadet_id LEFT JOIN cadet_medical_results mr ON c.id = mr.cadet_id LEFT JOIN medical_centers mc ON mr.medical_center_id = mc.id';
  let countParams = [];

  if (whereClauses.length > 0) {
    countQuery += ' WHERE ' + whereClauses.join(' AND ');
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
  const cadet = rows[0];

  if (cadet) {
    // Remove binary data to prevent it from being returned in the JSON response
    delete cadet.photo_data;
    delete cadet.photo_mime_type;
    delete cadet.photo_name;
  }

  return cadet;
};

const getShortlistedCadets = async (limit = 10, offset = 0, filters = {}) => {
  // We use casting because the fields are now VARCHARs
  let query = `
    SELECT c.*, i.institute_name
    FROM cadets c
    LEFT JOIN institutes i ON c.institute_id = i.id
    WHERE CAST(c.tenth_avg_percentage AS DECIMAL(10,2)) >= 85
      AND CAST(c.tenth_std_maths AS DECIMAL(10,2)) >= 80
      AND CAST(c.tenth_std_science AS DECIMAL(10,2)) >= 80
      AND CAST(c.tenth_std_english AS DECIMAL(10,2)) >= 80
      AND CAST(c.twelfth_pcm_avg_percentage AS DECIMAL(10,2)) >= 80
      AND CAST(c.twelfth_std_english AS DECIMAL(10,2)) >= 75
      AND CAST(c.twelfth_std_physics AS DECIMAL(10,2)) >= 75
      AND CAST(c.twelfth_std_chemistry AS DECIMAL(10,2)) >= 75
      AND CAST(c.twelfth_std_maths AS DECIMAL(10,2)) >= 75
      AND CAST(c.imu_rank AS SIGNED) <= 3000
      AND CAST(c.bmi AS DECIMAL(10,2)) < 25
  `;
  let queryParams = [];
  let additionalClauses = [];

  if (filters.batch_year && filters.batch_year !== 'all') {
    additionalClauses.push('c.batch_year = ?');
    queryParams.push(filters.batch_year);
  }

  if (filters.instituteId) {
    additionalClauses.push('c.institute_id = ?');
    queryParams.push(filters.instituteId);
  }

  if (filters.drive_id && filters.drive_id !== 'all') {
    additionalClauses.push('c.drive_id = ?');
    queryParams.push(filters.drive_id);
  }

  if (filters.course_type && filters.course_type !== 'all') {
    additionalClauses.push('c.course LIKE ?');
    queryParams.push(`%${filters.course_type}%`);
  }

  if (filters.search) {
    additionalClauses.push(
      '(c.name_as_in_indos_cert LIKE ? OR c.email_id LIKE ? OR c.contact_number LIKE ?)',
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

  let countQuery = `
    SELECT COUNT(*) as total 
    FROM cadets c
    WHERE CAST(c.tenth_avg_percentage AS DECIMAL(10,2)) >= 85
      AND CAST(c.tenth_std_maths AS DECIMAL(10,2)) >= 80
      AND CAST(c.tenth_std_science AS DECIMAL(10,2)) >= 80
      AND CAST(c.tenth_std_english AS DECIMAL(10,2)) >= 80
      AND CAST(c.twelfth_pcm_avg_percentage AS DECIMAL(10,2)) >= 80
      AND CAST(c.twelfth_std_english AS DECIMAL(10,2)) >= 75
      AND CAST(c.twelfth_std_physics AS DECIMAL(10,2)) >= 75
      AND CAST(c.twelfth_std_chemistry AS DECIMAL(10,2)) >= 75
      AND CAST(c.twelfth_std_maths AS DECIMAL(10,2)) >= 75
      AND CAST(c.imu_rank AS SIGNED) <= 3000
      AND CAST(c.bmi AS DECIMAL(10,2)) < 25
  `;
  let countParams = [];

  if (additionalClauses.length > 0) {
    countQuery += ' AND ' + additionalClauses.join(' AND ');
    countParams = queryParams.slice(0, queryParams.length - 2);
  }

  // Use try catch because CAST could fail on strings like LATERAL ENTRY
  try {
    const [[{ total }]] = await db.query(countQuery, countParams);
    return { data: rows, total };
  } catch (err) {
    return { data: [], total: 0 };
  }
};

const getShortlistCountByInstitute = async () => {
  const query = `
    SELECT 
      i.id as institute_id,
      i.institute_name,
      COUNT(c.id) as count
    FROM institutes i
    LEFT JOIN cadets c ON i.id = c.institute_id
      AND CAST(c.tenth_avg_percentage AS DECIMAL(10,2)) >= 85
      AND CAST(c.tenth_std_maths AS DECIMAL(10,2)) >= 80
      AND CAST(c.tenth_std_science AS DECIMAL(10,2)) >= 80
      AND CAST(c.tenth_std_english AS DECIMAL(10,2)) >= 80
      AND CAST(c.twelfth_pcm_avg_percentage AS DECIMAL(10,2)) >= 80
      AND CAST(c.twelfth_std_english AS DECIMAL(10,2)) >= 75
      AND CAST(c.twelfth_std_physics AS DECIMAL(10,2)) >= 75
      AND CAST(c.twelfth_std_chemistry AS DECIMAL(10,2)) >= 75
      AND CAST(c.twelfth_std_maths AS DECIMAL(10,2)) >= 75
      AND CAST(c.imu_rank AS SIGNED) <= 3000
      AND CAST(c.bmi AS DECIMAL(10,2)) < 25
    GROUP BY i.id, i.institute_name
    HAVING count > 0
    ORDER BY count DESC
  `;

  try {
    const [rows] = await db.query(query);
    return rows;
  } catch (err) {
    return [];
  }
};

const updateCadet = async (id, cadetData) => {
  const updateFields = [];
  const values = [];

  const allowedFields = Object.keys(cadetData);

  for (const field of allowedFields) {
    if (cadetData[field] !== undefined) {
      updateFields.push(`${field} = ?`);
      values.push(cadetData[field]);
    }
  }

  if (updateFields.length === 0) {
    return;
  }

  values.push(id);

  const query = `UPDATE cadets SET ${updateFields.join(', ')} WHERE id = ?`;
  await db.query(query, values);
};

const deleteCadet = async (id) => {
  await db.query('DELETE FROM cadets WHERE id = ?', [id]);
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

module.exports = {
  createCadet,
  findDuplicateCadet,
  getAllCadets,
  getCadetById,
  getShortlistedCadets,
  getShortlistCountByInstitute,
  updateCadet,
  deleteCadet,
  saveCadetPhoto,
  getCadetPhoto,
};
