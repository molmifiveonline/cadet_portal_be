const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const createLog = async (userId, action, details = '', ipAddress = null) => {
  try {
    const id = uuidv4();
    const query = `
      INSERT INTO activity_logs (id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `;
    await db.query(query, [id, userId, action, details, ipAddress]);
    return id;
  } catch (error) {
    console.error('Error creating activity log:', error);
    // Don't throw error to prevent blocking main flow
    return null;
  }
};

const getLogsLast3Months = async (limit, offset, searchTerm = '') => {
  try {
    let query = `
      SELECT 
        al.*,
        u.email as user_email,
        u.first_name,
        u.last_name,
        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_name
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
    `;

    const params = [];

    // Add search functionality
    if (searchTerm && searchTerm.trim() !== '') {
      query += ` AND (
        u.email LIKE ? 
        OR u.first_name LIKE ? 
        OR u.last_name LIKE ?
        OR al.action LIKE ? 
        OR al.details LIKE ?
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

    query += ` ORDER BY al.created_at DESC`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [rows] = await db.query(query, params);
    return rows;
  } catch (error) {
    console.error('Error fetching logs for last 3 months:', error);
    throw error;
  }
};

const countLogsLast3Months = async (searchTerm = '') => {
  try {
    let query = `
      SELECT COUNT(*) as count
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
    `;

    const params = [];

    // Add search functionality
    if (searchTerm && searchTerm.trim() !== '') {
      query += ` AND (
        u.email LIKE ? 
        OR u.first_name LIKE ? 
        OR u.last_name LIKE ?
        OR al.action LIKE ? 
        OR al.details LIKE ?
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

    const [rows] = await db.query(query, params);
    return rows[0].count;
  } catch (error) {
    console.error('Error counting logs for last 3 months:', error);
    throw error;
  }
};

module.exports = {
  createLog,
  getLogsLast3Months,
  countLogsLast3Months,
};
