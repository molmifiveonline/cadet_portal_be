const db = require('../config/database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const getUsers = async (limit, offset, search = '') => {
  let query =
    'SELECT id, email, first_name, last_name, status, created_at FROM users';
  let params = [];

  if (search) {
    const searchTerm = `%${search}%`;
    query +=
      ' WHERE id LIKE ? OR email LIKE ? OR first_name LIKE ? OR last_name LIKE ?';
    params = [searchTerm, searchTerm, searchTerm, searchTerm];
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
      ' WHERE id LIKE ? OR email LIKE ? OR first_name LIKE ? OR last_name LIKE ?';
    params = [searchTerm, searchTerm, searchTerm, searchTerm];
  }

  const [rows] = await db.query(query, params);
  return rows[0].count;
};

const createUser = async (email, password, first_name, last_name) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const id = uuidv4();

  await db.query(
    'INSERT INTO users (id, email, password, role, first_name, last_name) VALUES (?, ?, ?, ?, ?, ?)',
    [
      id,
      email,
      hashedPassword,
      'SuperAdmin',
      first_name || '',
      last_name || '',
    ],
  );
  return { id, email, role: 'SuperAdmin', first_name, last_name };
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
  first_name,
  last_name,
  status,
  password = null,
) => {
  let query;
  let params;

  if (password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    query =
      'UPDATE users SET email = ?, first_name = ?, last_name = ?, status = ?, password = ? WHERE id = ?';
    params = [
      email,
      first_name || '',
      last_name || '',
      status,
      hashedPassword,
      id,
    ];
  } else {
    query =
      'UPDATE users SET email = ?, first_name = ?, last_name = ?, status = ? WHERE id = ?';
    params = [email, first_name || '', last_name || '', status, id];
  }

  const [result] = await db.query(query, params);
  return result.affectedRows > 0;
};

const deleteUser = async (id) => {
  const [result] = await db.query('DELETE FROM users WHERE id = ?', [id]);
  return result.affectedRows > 0;
};

const updateUserStatus = async (id, status) => {
  const [result] = await db.query('UPDATE users SET status = ? WHERE id = ?', [
    status,
    id,
  ]);
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
  updateUserStatus,
};
