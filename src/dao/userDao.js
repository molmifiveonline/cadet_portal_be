const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

const findUserByEmail = async (email) => {
  const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0];
};

const findUserById = async (id) => {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0];
};

const createUser = async (userData) => {
  const { email, password, role } = userData;
  const id = uuidv4();

  await db.query(
    `INSERT INTO users (id, email, password, role) 
     VALUES (?, ?, ?, ?)`,
    [id, email, password, role || 'admin'],
  );
  return id;
};

const createCandidateProfile = async (profileData) => {
  const fields = Object.keys(profileData).join(', ');
  const placeholders = Object.keys(profileData)
    .map(() => '?')
    .join(', ');
  const values = Object.values(profileData);

  await db.query(
    `INSERT INTO candidate_profiles (${fields}) VALUES (${placeholders})`,
    values,
  );
};

const updateUserPassword = async (id, hashedPassword) => {
  const [result] = await db.query(
    'UPDATE users SET password = ? WHERE id = ?',
    [hashedPassword, id],
  );
  return result.affectedRows > 0;
};

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  createCandidateProfile,
  updateUserPassword,
};
