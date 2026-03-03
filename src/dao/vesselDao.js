const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createVessel = async (vesselData) => {
  const id = uuidv4();
  const query = `
    INSERT INTO vessels (id, name, imo_number, vessel_type, flag, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  await db.query(query, [
    id,
    vesselData.name,
    vesselData.imo_number,
    vesselData.vessel_type || null,
    vesselData.flag || null,
    vesselData.status || 'Active',
  ]);
  return id;
};

const getAllVessels = async (
  limit,
  offset,
  searchTerm = '',
  filters = {},
  sortKey = 'created_at',
  sortDir = 'DESC',
) => {
  // Whitelist allowed sort columns to prevent SQL injection
  const allowedSortKeys = [
    'name',
    'imo_number',
    'vessel_type',
    'flag',
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
  if (filters.vessel_type && filters.vessel_type.trim() !== '') {
    whereClause += ' AND vessel_type LIKE ?';
    params.push(`%${filters.vessel_type}%`);
  }

  if (filters.flag && filters.flag.trim() !== '') {
    whereClause += ' AND flag LIKE ?';
    params.push(`%${filters.flag}%`);
  }

  if (filters.status && filters.status.trim() !== '') {
    whereClause += ' AND status = ?';
    params.push(filters.status);
  }

  // Global text search across all searchable columns
  if (searchTerm && searchTerm.trim() !== '') {
    whereClause += ` AND (
      name LIKE ?
      OR imo_number LIKE ?
      OR vessel_type LIKE ?
      OR flag LIKE ?
    )`;
    const searchPattern = `%${searchTerm}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  // Data query
  const dataQuery = `SELECT * FROM vessels${whereClause} ORDER BY ${safeSortKey} ${safeSortDir} LIMIT ? OFFSET ?`;
  const dataParams = [...params, limit, offset];
  const [rows] = await db.query(dataQuery, dataParams);

  // Count query
  const countQuery = `SELECT COUNT(*) as count FROM vessels${whereClause}`;
  const [countRows] = await db.query(countQuery, params);
  const total = countRows[0].count;

  return { data: rows, total };
};

const getVesselById = async (id) => {
  const query = `SELECT * FROM vessels WHERE id = ?`;
  const [rows] = await db.query(query, [id]);
  return rows.length > 0 ? rows[0] : null;
};

const updateVessel = async (id, vesselData) => {
  const query = `
    UPDATE vessels 
    SET name = COALESCE(?, name),
        imo_number = COALESCE(?, imo_number),
        vessel_type = COALESCE(?, vessel_type),
        flag = COALESCE(?, flag),
        status = COALESCE(?, status)
    WHERE id = ?
  `;
  const [result] = await db.query(query, [
    vesselData.name !== undefined ? vesselData.name : null,
    vesselData.imo_number !== undefined ? vesselData.imo_number : null,
    vesselData.vessel_type !== undefined ? vesselData.vessel_type : null,
    vesselData.flag !== undefined ? vesselData.flag : null,
    vesselData.status !== undefined ? vesselData.status : null,
    id,
  ]);
  return result.affectedRows > 0;
};

const deleteVessel = async (id) => {
  const query = `DELETE FROM vessels WHERE id = ?`;
  const [result] = await db.query(query, [id]);
  return result.affectedRows > 0;
};

module.exports = {
  createVessel,
  getAllVessels,
  getVesselById,
  updateVessel,
  deleteVessel,
};
