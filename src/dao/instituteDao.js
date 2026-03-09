const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const bcrypt = require('bcryptjs');

const createInstitute = async (instituteData) => {
  const {
    institute_name,
    address,
    location,
    institute_type,
    contact_emails,
    status = 'active',
  } = instituteData;
  const id = uuidv4();

  await db.query(
    `INSERT INTO institutes (id, institute_name, address, location, institute_type, contact_emails, status) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      institute_name,
      address,
      location,
      institute_type || null,
      contact_emails ? JSON.stringify(contact_emails) : null,
      status,
    ],
  );
  return id;
};

const getAllInstitutes = async (
  limit,
  offset,
  sortBy,
  sortOrder,
  search,
  hasSubmissions = false,
) => {
  let query = 'SELECT DISTINCT i.* FROM institutes i';
  let countQuery = 'SELECT COUNT(DISTINCT i.id) as total FROM institutes i';
  let queryParams = [];
  let countParams = [];

  if (hasSubmissions) {
    // Only return institutes that have cadets in the system (i.e. present in the table)
    query += ' JOIN cadets c ON i.id = c.institute_id';
    countQuery += ' JOIN cadets c ON i.id = c.institute_id';
  }

  if (search) {
    const searchPattern = `%${search}%`;

    const whereClause = ` WHERE (
      i.institute_name LIKE ? OR 
      i.address LIKE ? OR 
      i.location LIKE ? OR
      i.institute_type LIKE ? OR
      i.contact_emails LIKE ?
    )`;

    query += whereClause;
    countQuery += whereClause;
    const searchParams = [
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
    ];
    queryParams.push(...searchParams);
    countParams.push(...searchParams);
  }

  query += ` ORDER BY i.${sortBy} ${sortOrder}`;

  // Only apply limit/offset if they are valid numbers (not -1 for "all")
  if (limit && limit > 0) {
    query += ' LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);
  }

  const [rows] = await db.query(query, queryParams);
  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data: rows, total };
};

const getInstituteById = async (id) => {
  const [rows] = await db.query('SELECT * FROM institutes WHERE id = ?', [id]);
  return rows[0];
};

const updateInstitute = async (id, instituteData) => {
  const {
    institute_name,
    address,
    location,
    institute_type,
    contact_emails,
    status,
  } = instituteData;

  const [result] = await db.query(
    `UPDATE institutes 
     SET institute_name = ?, address = ?, location = ?, institute_type = ?, contact_emails = ?, status = COALESCE(?, status)
     WHERE id = ?`,
    [
      institute_name,
      address,
      location,
      institute_type || null,
      contact_emails ? JSON.stringify(contact_emails) : null,
      status || null,
      id,
    ],
  );
  return result.affectedRows > 0;
};

const deleteInstitute = async (id) => {
  const [result] = await db.query('DELETE FROM institutes WHERE id = ?', [id]);
  return result.affectedRows > 0;
};

const createSubmission = async (
  instituteId,
  fileName,
  originalName,
  fileData,
  batch_year,
) => {
  const id = uuidv4();
  await db.query(
    'INSERT INTO institute_submissions (id, institute_id, file_name, original_name, file_data, batch_year) VALUES (?, ?, ?, ?, ?, ?)',
    [id, instituteId, fileName, originalName, fileData, batch_year],
  );
  return id;
};

const getAllSubmissions = async (
  limit = 10,
  offset = 0,
  status = 'all',
  search = '',
) => {
  // Exclude file_data from this query for performance
  let query = `
    SELECT isub.id, isub.institute_id, isub.file_name, isub.original_name, isub.status, isub.created_at, isub.batch_year, i.institute_name 
    FROM institute_submissions isub
    LEFT JOIN institutes i ON isub.institute_id = i.id
  `;
  let queryParams = [];
  let whereClauses = [];

  if (status !== 'all') {
    whereClauses.push('isub.status = ?');
    queryParams.push(status);
  }

  if (search) {
    const searchPattern = `%${search}%`;
    whereClauses.push('(i.institute_name LIKE ? OR isub.original_name LIKE ?)');
    queryParams.push(searchPattern, searchPattern);
  }

  if (whereClauses.length > 0) {
    query += ' WHERE ' + whereClauses.join(' AND ');
  }

  query += ' ORDER BY isub.created_at DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);

  let countQuery = `
    SELECT COUNT(*) as total 
    FROM institute_submissions isub
    LEFT JOIN institutes i ON isub.institute_id = i.id
  `;

  // Re-use params for count query (excluding limit/offset)
  const countParams = queryParams.slice(0, queryParams.length - 2);

  if (whereClauses.length > 0) {
    countQuery += ' WHERE ' + whereClauses.join(' AND ');
  }

  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data: rows, total };
};

const deleteSubmission = async (id) => {
  const [result] = await db.query(
    'DELETE FROM institute_submissions WHERE id = ?',
    [id],
  );
  return result.affectedRows > 0;
};

const deleteSubmissions = async (ids) => {
  if (!ids || ids.length === 0) return 0;
  // Creating a placeholder string like (?, ?, ?)
  const placeholders = ids.map(() => '?').join(',');
  const [result] = await db.query(
    `DELETE FROM institute_submissions WHERE id IN (${placeholders})`,
    ids,
  );
  return result.affectedRows;
};

const getSubmissionById = async (id) => {
  const [rows] = await db.query(
    'SELECT id, institute_id, file_name, original_name, status, created_at, batch_year FROM institute_submissions WHERE id = ?',
    [id],
  );
  return rows[0];
};

const getSubmissionFile = async (id) => {
  const [rows] = await db.query(
    'SELECT file_data, file_name, original_name FROM institute_submissions WHERE id = ?',
    [id],
  );
  return rows[0];
};

const updateSubmissionStatus = async (id, status) => {
  const [result] = await db.query(
    'UPDATE institute_submissions SET status = ? WHERE id = ?',
    [status, id],
  );
  return result.affectedRows > 0;
  return result.affectedRows > 0;
};

const updateInstituteCredentials = async (
  id,
  tempUsername,
  tempPassword,
  tempExpiry,
  batch_year,
) => {
  const hashedPassword = await bcrypt.hash(tempPassword, 10);
  const [result] = await db.query(
    `UPDATE institutes 
     SET temp_username = ?, temp_password = ?, temp_expiry = ?, batch_year = ?
     WHERE id = ?`,
    [tempUsername, hashedPassword, tempExpiry, batch_year, id],
  );
  return result.affectedRows > 0;
};

const extendInstituteExpiry = async (id, newExpiry) => {
  const [result] = await db.query(
    'UPDATE institutes SET temp_expiry = ? WHERE id = ?',
    [newExpiry, id],
  );
  return result.affectedRows > 0;
};

const getInstituteByTempUsername = async (username) => {
  const [rows] = await db.query(
    'SELECT * FROM institutes WHERE temp_username = ?',
    [username],
  );
  return rows[0];
};

const getInstituteByEmail = async (email) => {
  const [rows] = await db.query(
    'SELECT * FROM institutes WHERE contact_emails LIKE ?',
    [`%"email":"${email}"%`],
  );
  return rows[0];
};

module.exports = {
  createInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  deleteInstitute,
  createSubmission,
  getAllSubmissions,
  deleteSubmission,
  deleteSubmissions,
  getSubmissionById,
  getSubmissionFile,
  updateSubmissionStatus,
  updateInstituteCredentials,
  extendInstituteExpiry,
  getInstituteByTempUsername,
  getInstituteByEmail,
};
