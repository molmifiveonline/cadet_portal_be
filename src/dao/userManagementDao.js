const db = require('../config/database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const getUsers = async (limit, offset, search = '') => {
  let query =
    'SELECT id, email, role, first_name, last_name, created_at FROM users';
  let params = [];

  if (search) {
    const searchTerm = `%${search}%`;
    query +=
      ' WHERE id LIKE ? OR email LIKE ? OR role LIKE ? OR first_name LIKE ? OR last_name LIKE ?';
    params = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm];
  }

  query += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [rows] = await db.query(query, params);
  return rows;
};

const countUsers = async (search = '') => {
  let query = 'SELECT COUNT(*) as count FROM users';
  let params = [];

  if (search) {
    const searchTerm = `%${search}%`;
    query +=
      ' WHERE id LIKE ? OR email LIKE ? OR role LIKE ? OR first_name LIKE ? OR last_name LIKE ?';
    params = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm];
  }

  const [rows] = await db.query(query, params);
  return rows[0].count;
};

const createUser = async (email, password, role, first_name, last_name) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const id = uuidv4();

  // Insert user with first_name and last_name fields
  await db.query(
    'INSERT INTO users (id, email, password, role, first_name, last_name) VALUES (?, ?, ?, ?, ?, ?)',
    [id, email, hashedPassword, role, first_name || '', last_name || ''],
  );
  return { id, email, role, first_name, last_name };
};

const findUserByEmail = async (email) => {
  const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0];
};

const findUserById = async (id) => {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0];
};

const updateUser = async (
  id,
  email,
  role,
  first_name,
  last_name,
  password = null,
) => {
  let query;
  let params;

  if (password) {
    // If password is provided, hash it and update
    const hashedPassword = await bcrypt.hash(password, 10);
    query =
      'UPDATE users SET email = ?, role = ?, first_name = ?, last_name = ?, password = ? WHERE id = ?';
    params = [
      email,
      role,
      first_name || '',
      last_name || '',
      hashedPassword,
      id,
    ];
  } else {
    // Update without changing password
    query =
      'UPDATE users SET email = ?, role = ?, first_name = ?, last_name = ? WHERE id = ?';
    params = [email, role, first_name || '', last_name || '', id];
  }

  const [result] = await db.query(query, params);
  return result.affectedRows > 0;
};

const deleteUser = async (id) => {
  const [result] = await db.query('DELETE FROM users WHERE id = ?', [id]);
  return result.affectedRows > 0;
};

module.exports = {
  getUsers,
  countUsers,
  createUser,
  findUserByEmail,
  findUserById,
  updateUser,
  deleteUser,
};
