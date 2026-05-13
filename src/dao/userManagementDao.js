const db = require('../config/database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const getUsers = async (
  limit,
  offset,
  search = '',
  sortBy = 'created_at',
  sortOrder = 'DESC',
) => {
  // Whitelist columns for sorting to prevent SQL injection
  const allowedColumns = [
    'email',
    'first_name',
    'last_name',
    'role',
    'status',
    'created_at',
  ];
  const validatedSortBy = allowedColumns.includes(sortBy)
    ? sortBy
    : 'created_at';
  const validatedSortOrder =
    sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  let query =
    'SELECT id, email, first_name, last_name, role, status, created_at FROM users';
  let params = [];

  if (search) {
    const searchTerm = `%${search}%`;
    query +=
      ' WHERE id LIKE ? OR email LIKE ? OR first_name LIKE ? OR last_name LIKE ?';
    params = [searchTerm, searchTerm, searchTerm, searchTerm];
  }

  query += ` ORDER BY ${validatedSortBy} ${validatedSortOrder}`;
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

const createUser = async (
  email,
  password,
  first_name,
  last_name,
  role,
  status = 'active',
) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const id = uuidv4();

  await db.query(
    'INSERT INTO users (id, email, password, role, first_name, last_name, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      email,
      hashedPassword,
      role || 'SuperAdmin',
      first_name || '',
      last_name || '',
      status,
    ],
  );
  return {
    id,
    email,
    role: role || 'SuperAdmin',
    first_name,
    last_name,
    status,
  };
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
  role,
  password = null,
) => {
  let query;
  let params;

  if (password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    query =
      'UPDATE users SET email = ?, first_name = ?, last_name = ?, status = ?, role = ?, password = ? WHERE id = ?';
    params = [
      email,
      first_name || '',
      last_name || '',
      status,
      role,
      hashedPassword,
      id,
    ];
  } else {
    query =
      'UPDATE users SET email = ?, first_name = ?, last_name = ?, status = ?, role = ? WHERE id = ?';
    params = [email, first_name || '', last_name || '', status, role, id];
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
