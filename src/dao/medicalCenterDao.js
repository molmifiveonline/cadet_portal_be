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

const getAllMedicalCenters = async (limit, offset, searchTerm = '') => {
  let query = `
    SELECT * FROM medical_centers
    WHERE 1=1
  `;
  const params = [];

  if (searchTerm && searchTerm.trim() !== '') {
    query += ` AND (
      center_name LIKE ? 
      OR location LIKE ?
      OR contact_person LIKE ?
      OR tests_offered LIKE ?
    )`;
    const searchPattern = `%${searchTerm}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const [rows] = await db.query(query, params);
  return rows;
};

const countAllMedicalCenters = async (searchTerm = '') => {
  let query = `
    SELECT COUNT(*) as count FROM medical_centers
    WHERE 1=1
  `;
  const params = [];

  if (searchTerm && searchTerm.trim() !== '') {
    query += ` AND (
      center_name LIKE ? 
      OR location LIKE ?
      OR contact_person LIKE ?
      OR tests_offered LIKE ?
    )`;
    const searchPattern = `%${searchTerm}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  const [rows] = await db.query(query, params);
  return rows[0].count;
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
  countAllMedicalCenters,
  getMedicalCenterById,
  getMedicalCenterByEmail,
  updateMedicalCenter,
  deleteMedicalCenter,
};
