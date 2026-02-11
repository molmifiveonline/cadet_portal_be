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

module.exports = {
  createInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  deleteInstitute,
};
