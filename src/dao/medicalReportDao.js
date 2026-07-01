const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createMedicalReport = async (reportData) => {
  const id = uuidv4();
  const query = `
    INSERT INTO medical_reports (id, name, status)
    VALUES (?, ?, ?)
  `;
  await db.query(query, [
    id,
    reportData.name,
    reportData.status || 'Active',
  ]);
  return id;
};

const getAllMedicalReports = async (
  limit,
  offset,
  searchTerm = '',
  filters = {},
  sortKey = 'created_at',
  sortDir = 'DESC',
) => {
  const allowedSortKeys = ['name', 'status', 'created_at'];
  const safeSortKey = allowedSortKeys.includes(sortKey) ? sortKey : 'created_at';
  const safeSortDir = sortDir === 'ASC' ? 'ASC' : 'DESC';

  let whereClause = ' WHERE 1=1';
  const params = [];

  if (filters.status && filters.status.trim() !== '') {
    whereClause += ' AND status = ?';
    params.push(filters.status);
  }

  if (searchTerm && searchTerm.trim() !== '') {
    whereClause += ' AND (name LIKE ?)';
    params.push(`%${searchTerm}%`);
  }

  let limitOffsetClause = '';
  const dataParams = [...params];
  if (limit !== undefined && offset !== undefined) {
    limitOffsetClause = ' LIMIT ? OFFSET ?';
    dataParams.push(Number(limit), Number(offset));
  }

  const dataQuery = `SELECT * FROM medical_reports${whereClause} ORDER BY ${safeSortKey} ${safeSortDir}${limitOffsetClause}`;
  const [rows] = await db.query(dataQuery, dataParams);

  const countQuery = `SELECT COUNT(*) as count FROM medical_reports${whereClause}`;
  const [countRows] = await db.query(countQuery, params);
  const total = countRows[0].count;

  return { data: rows, total };
};

const getMedicalReportById = async (id) => {
  const query = `SELECT * FROM medical_reports WHERE id = ?`;
  const [rows] = await db.query(query, [id]);
  return rows.length > 0 ? rows[0] : null;
};

const getMedicalReportByName = async (name) => {
  const query = `SELECT * FROM medical_reports WHERE name = ?`;
  const [rows] = await db.query(query, [name]);
  return rows.length > 0 ? rows[0] : null;
};

const updateMedicalReport = async (id, reportData) => {
  const query = `
    UPDATE medical_reports 
    SET name = COALESCE(?, name),
        status = COALESCE(?, status)
    WHERE id = ?
  `;
  const [result] = await db.query(query, [
    reportData.name !== undefined ? reportData.name : null,
    reportData.status !== undefined ? reportData.status : null,
    id,
  ]);
  return result.affectedRows > 0;
};

const deleteMedicalReport = async (id) => {
  const query = `DELETE FROM medical_reports WHERE id = ?`;
  const [result] = await db.query(query, [id]);
  return result.affectedRows > 0;
};

module.exports = {
  createMedicalReport,
  getAllMedicalReports,
  getMedicalReportById,
  getMedicalReportByName,
  updateMedicalReport,
  deleteMedicalReport,
};
