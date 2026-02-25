const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createCadet = async (cadetData) => {
  const allowedFields = Object.keys(cadetData);
  const id = uuidv4();

  const fields = ['id', ...allowedFields];
  const placeholders = fields.map(() => '?').join(', ');
  const values = [id, ...allowedFields.map((f) => cadetData[f])];

  await db.query(
    `INSERT INTO cadets (${fields.join(', ')}) VALUES (${placeholders})`,
    values,
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

  if (filters.adminYear && filters.adminYear !== 'all') {
    whereClauses.push('c.batch_year = ?');
    queryParams.push(filters.adminYear);
  }

  if (filters.instituteId) {
    whereClauses.push('c.institute_id = ?');
    queryParams.push(filters.instituteId);
  }

  if (filters.batch) {
    whereClauses.push('c.batch LIKE ?');
    queryParams.push(`%${filters.batch}%`);
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

  let countQuery = 'SELECT COUNT(*) as total FROM cadets c';
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
  return rows[0];
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

  if (filters.adminYear && filters.adminYear !== 'all') {
    additionalClauses.push('c.batch_year = ?');
    queryParams.push(filters.adminYear);
  }

  if (filters.instituteId) {
    additionalClauses.push('c.institute_id = ?');
    queryParams.push(filters.instituteId);
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

const updateCVData = async (cadetId, cvData) => {
  const updateFields = [];
  const values = [];

  const allowedFields = Object.keys(cvData);

  for (const field of allowedFields) {
    if (cvData[field] !== undefined) {
      updateFields.push(`${field} = ?`);
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
