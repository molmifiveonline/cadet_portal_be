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

const getAllVessels = async (limit, offset, searchTerm = '') => {
  let query = `
    SELECT * FROM vessels
    WHERE 1=1
  `;
  const params = [];

  if (searchTerm && searchTerm.trim() !== '') {
    query += ` AND (
      name LIKE ? 
      OR imo_number LIKE ?
      OR vessel_type LIKE ?
      OR flag LIKE ?
    )`;
    const searchPattern = `%${searchTerm}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const [rows] = await db.query(query, params);
  return rows;
};

const countAllVessels = async (searchTerm = '') => {
  let query = `
    SELECT COUNT(*) as count FROM vessels
    WHERE 1=1
  `;
  const params = [];

  if (searchTerm && searchTerm.trim() !== '') {
    query += ` AND (
      name LIKE ? 
      OR imo_number LIKE ?
      OR vessel_type LIKE ?
      OR flag LIKE ?
    )`;
    const searchPattern = `%${searchTerm}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  const [rows] = await db.query(query, params);
  return rows[0].count;
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
  countAllVessels,
  getVesselById,
  updateVessel,
  deleteVessel,
};
