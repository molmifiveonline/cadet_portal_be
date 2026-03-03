const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createMedicalCenter = async (centerData) => {
  const id = uuidv4();
  const query = `
    INSERT INTO medical_centers (id, center_name, location, tests_offered, contact_person, email, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  await db.query(query, [
    id,
    centerData.center_name,
    centerData.location,
    centerData.tests_offered || null,
    centerData.contact_person || null,
    centerData.email || null,
    centerData.status || 'Active',
  ]);
  return id;
};

const getAllMedicalCenters = async (
  limit,
  offset,
  searchTerm = '',
  filters = {},
  sortKey = 'created_at',
  sortDir = 'DESC',
) => {
  // Whitelist allowed sort columns to prevent SQL injection
  const allowedSortKeys = [
    'center_name',
    'location',
    'email',
    'contact_person',
    'tests_offered',
    'status',
    'created_at',
  ];
  const safeSortKey = allowedSortKeys.includes(sortKey)
    ? sortKey
    : 'created_at';
  const safeSortDir = sortDir === 'ASC' ? 'ASC' : 'DESC';

  let whereClause = ' WHERE 1=1';
  const params = [];

  // Individual field filters
  if (filters.location && filters.location.trim() !== '') {
    whereClause += ' AND location LIKE ?';
    params.push(`%${filters.location}%`);
  }

  if (filters.status && filters.status.trim() !== '') {
    whereClause += ' AND status = ?';
    params.push(filters.status);
  }

  if (filters.contact_person && filters.contact_person.trim() !== '') {
    whereClause += ' AND contact_person LIKE ?';
    params.push(`%${filters.contact_person}%`);
  }

  if (filters.tests_offered && filters.tests_offered.trim() !== '') {
    whereClause += ' AND tests_offered LIKE ?';
    params.push(`%${filters.tests_offered}%`);
  }

  // Global text search across all searchable columns
  if (searchTerm && searchTerm.trim() !== '') {
    whereClause += ` AND (
      center_name LIKE ?
      OR location LIKE ?
      OR contact_person LIKE ?
      OR tests_offered LIKE ?
      OR email LIKE ?
    )`;
    const searchPattern = `%${searchTerm}%`;
    params.push(
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
    );
  }

  // Data query
  const dataQuery = `SELECT * FROM medical_centers${whereClause} ORDER BY ${safeSortKey} ${safeSortDir} LIMIT ? OFFSET ?`;
  const dataParams = [...params, limit, offset];
  const [rows] = await db.query(dataQuery, dataParams);

  // Count query
  const countQuery = `SELECT COUNT(*) as count FROM medical_centers${whereClause}`;
  const [countRows] = await db.query(countQuery, params);
  const total = countRows[0].count;

  return { data: rows, total };
};

const getMedicalCenterById = async (id) => {
  const query = `SELECT * FROM medical_centers WHERE id = ?`;
  const [rows] = await db.query(query, [id]);
  return rows.length > 0 ? rows[0] : null;
};

const getMedicalCenterByEmail = async (email) => {
  const query = `SELECT * FROM medical_centers WHERE email = ?`;
  const [rows] = await db.query(query, [email]);
  return rows.length > 0 ? rows[0] : null;
};

const updateMedicalCenter = async (id, updateData) => {
  const query = `
    UPDATE medical_centers 
    SET center_name = COALESCE(?, center_name),
        location = COALESCE(?, location),
        tests_offered = COALESCE(?, tests_offered),
        contact_person = COALESCE(?, contact_person),
        email = COALESCE(?, email),
        status = COALESCE(?, status)
    WHERE id = ?
  `;
  const [result] = await db.query(query, [
    updateData.center_name !== undefined ? updateData.center_name : null,
    updateData.location !== undefined ? updateData.location : null,
    updateData.tests_offered !== undefined ? updateData.tests_offered : null,
    updateData.contact_person !== undefined ? updateData.contact_person : null,
    updateData.email !== undefined ? updateData.email : null,
    updateData.status !== undefined ? updateData.status : null,
    id,
  ]);
  return result.affectedRows > 0;
};

const deleteMedicalCenter = async (id) => {
  const query = `DELETE FROM medical_centers WHERE id = ?`;
  const [result] = await db.query(query, [id]);
  return result.affectedRows > 0;
};

module.exports = {
  createMedicalCenter,
  getAllMedicalCenters,
  getMedicalCenterById,
  getMedicalCenterByEmail,
  updateMedicalCenter,
  deleteMedicalCenter,
};
