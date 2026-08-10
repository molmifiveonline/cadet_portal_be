const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createVessel = async (vesselData) => {
  const id = uuidv4();
  const query = `
    INSERT INTO vessels (id, name, imo_number, vessel_type, vessel_type_id, department, flag, status, location, total_seats, voyage_ref, reporting_port, joining_date, communication_details, contact_person_name, contact_person_email, contact_person_phone, required_documents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  await db.query(query, [
    id,
    vesselData.name,
    vesselData.imo_number,
    vesselData.vessel_type || null,
    vesselData.vessel_type_id || null,
    vesselData.department || 'Both',
    vesselData.flag || null,
    vesselData.status || 'Active',
    vesselData.location || null,
    vesselData.total_seats || 0,
    vesselData.voyage_ref || null,
    vesselData.reporting_port || null,
    vesselData.joining_date || null,
    vesselData.communication_details || null,
    vesselData.contact_person_name || null,
    vesselData.contact_person_email || null,
    vesselData.contact_person_phone || null,
    vesselData.required_documents ? JSON.stringify(vesselData.required_documents) : null,
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
    'department',
    'flag',
    'status',
    'created_at',
    'location',
    'total_seats',
    'voyage_ref',
    'reporting_port',
    'joining_date',
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
  const dataQuery = `SELECT v.*,
    (SELECT COALESCE(SUM(
      (a.vessel_id=v.id AND a.allocation_status IN ('Allocated','Hold'))
      + (a.secondary_vessel_id=v.id AND a.secondary_allocation_status IN ('Allocated','Hold'))
    ),0) FROM allocations a WHERE a.is_active=1) AS reserved_seats,
    GREATEST(v.total_seats - (SELECT COALESCE(SUM(
      (a.vessel_id=v.id AND a.allocation_status IN ('Allocated','Hold'))
      + (a.secondary_vessel_id=v.id AND a.secondary_allocation_status IN ('Allocated','Hold'))
    ),0) FROM allocations a WHERE a.is_active=1), 0) AS available_seats
    FROM vessels v${whereClause} ORDER BY ${safeSortKey} ${safeSortDir} LIMIT ? OFFSET ?`;
  const dataParams = [...params, limit, offset];
  const [rows] = await db.query(dataQuery, dataParams);

  // Count query
  const countQuery = `SELECT COUNT(*) as count FROM vessels${whereClause}`;
  const [countRows] = await db.query(countQuery, params);
  const total = countRows[0].count;

  return { data: rows, total };
};

const getVesselById = async (id) => {
  const query = `SELECT v.*,
    (SELECT COALESCE(SUM(
      (a.vessel_id=v.id AND a.allocation_status IN ('Allocated','Hold'))
      + (a.secondary_vessel_id=v.id AND a.secondary_allocation_status IN ('Allocated','Hold'))
    ),0) FROM allocations a WHERE a.is_active=1) AS reserved_seats,
    GREATEST(v.total_seats - (SELECT COALESCE(SUM(
      (a.vessel_id=v.id AND a.allocation_status IN ('Allocated','Hold'))
      + (a.secondary_vessel_id=v.id AND a.secondary_allocation_status IN ('Allocated','Hold'))
    ),0) FROM allocations a WHERE a.is_active=1), 0) AS available_seats
    FROM vessels v WHERE v.id = ?`;
  const [rows] = await db.query(query, [id]);
  return rows.length > 0 ? rows[0] : null;
};

const updateVessel = async (id, vesselData) => {
  const query = `
    UPDATE vessels 
    SET name = COALESCE(?, name),
        imo_number = COALESCE(?, imo_number),
        vessel_type = COALESCE(?, vessel_type),
        vessel_type_id = COALESCE(?, vessel_type_id),
        department = COALESCE(?, department),
        flag = COALESCE(?, flag),
        status = COALESCE(?, status),
        location = COALESCE(?, location),
        total_seats = COALESCE(?, total_seats),
        voyage_ref = COALESCE(?, voyage_ref),
        reporting_port = COALESCE(?, reporting_port),
        joining_date = COALESCE(?, joining_date),
        communication_details = COALESCE(?, communication_details),
        contact_person_name = COALESCE(?, contact_person_name),
        contact_person_email = COALESCE(?, contact_person_email),
        contact_person_phone = COALESCE(?, contact_person_phone),
        required_documents = COALESCE(?, required_documents)
    WHERE id = ?
  `;
  const [result] = await db.query(query, [
    vesselData.name !== undefined ? vesselData.name : null,
    vesselData.imo_number !== undefined ? vesselData.imo_number : null,
    vesselData.vessel_type !== undefined ? vesselData.vessel_type : null,
    vesselData.vessel_type_id !== undefined ? vesselData.vessel_type_id : null,
    vesselData.department !== undefined ? vesselData.department : null,
    vesselData.flag !== undefined ? vesselData.flag : null,
    vesselData.status !== undefined ? vesselData.status : null,
    vesselData.location !== undefined ? vesselData.location : null,
    vesselData.total_seats !== undefined ? vesselData.total_seats : null,
    vesselData.voyage_ref !== undefined ? vesselData.voyage_ref : null,
    vesselData.reporting_port !== undefined ? vesselData.reporting_port : null,
    vesselData.joining_date !== undefined ? vesselData.joining_date : null,
    vesselData.communication_details !== undefined ? vesselData.communication_details : null,
    vesselData.contact_person_name !== undefined ? vesselData.contact_person_name : null,
    vesselData.contact_person_email !== undefined ? vesselData.contact_person_email : null,
    vesselData.contact_person_phone !== undefined ? vesselData.contact_person_phone : null,
    vesselData.required_documents !== undefined ? JSON.stringify(vesselData.required_documents) : null,
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
