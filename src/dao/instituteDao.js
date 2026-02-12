const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

const createInstitute = async (instituteData) => {
  const { institute_name, institute_email, mobile_number, address, location } =
    instituteData;
  const id = uuidv4();

  await db.query(
    `INSERT INTO institutes (id, institute_name, institute_email, mobile_number, address, location) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, institute_name, institute_email, mobile_number, address, location],
  );
  return id;
};

const getAllInstitutes = async (limit, offset, sortBy, sortOrder, search) => {
  let query = 'SELECT * FROM institutes';
  let countQuery = 'SELECT COUNT(*) as total FROM institutes';
  let queryParams = [];
  let countParams = [];

  if (search) {
    const searchPattern = `%${search}%`;
    const whereClause = ` WHERE 
      institute_name LIKE ? OR 
      institute_email LIKE ? OR 
      mobile_number LIKE ? OR 
      address LIKE ? OR 
      location LIKE ?`;
    query += whereClause;
    countQuery += whereClause;
    queryParams = [
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
    ];
    countParams = [...queryParams];
  }

  query += ` ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);
  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data: rows, total };
};

const getInstituteById = async (id) => {
  const [rows] = await db.query('SELECT * FROM institutes WHERE id = ?', [id]);
  return rows[0];
};

const updateInstitute = async (id, instituteData) => {
  const { institute_name, institute_email, mobile_number, address, location } =
    instituteData;

  const [result] = await db.query(
    `UPDATE institutes 
     SET institute_name = ?, institute_email = ?, mobile_number = ?, address = ?, location = ?
     WHERE id = ?`,
    [institute_name, institute_email, mobile_number, address, location, id],
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
) => {
  const id = uuidv4();
  await db.query(
    'INSERT INTO institute_submissions (id, institute_id, file_name, original_name, file_data) VALUES (?, ?, ?, ?, ?)',
    [id, instituteId, fileName, originalName, fileData],
  );
  return id;
};

const getAllSubmissions = async (limit = 10, offset = 0, status = 'all') => {
  // Exclude file_data from this query for performance
  let query = `
    SELECT isub.id, isub.institute_id, isub.file_name, isub.original_name, isub.status, isub.created_at, i.institute_name 
    FROM institute_submissions isub
    LEFT JOIN institutes i ON isub.institute_id = i.id
  `;
  let queryParams = [];

  if (status !== 'all') {
    query += ' WHERE isub.status = ?';
    queryParams.push(status);
  }

  query += ' ORDER BY isub.created_at DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);

  let countQuery = 'SELECT COUNT(*) as total FROM institute_submissions';
  let countParams = [];
  if (status !== 'all') {
    countQuery += ' WHERE status = ?';
    countParams.push(status);
  }
  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data: rows, total };
};

const getSubmissionById = async (id) => {
  const [rows] = await db.query(
    'SELECT id, institute_id, file_name, original_name, status, created_at FROM institute_submissions WHERE id = ?',
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
};

module.exports = {
  createInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  deleteInstitute,
  createSubmission,
  getAllSubmissions,
  getSubmissionById,
  getSubmissionFile,
  updateSubmissionStatus,
};
