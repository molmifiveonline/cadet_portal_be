const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { ACTIVITY_LOG_RETENTION_MONTHS } = require('../config/constants');

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
        COALESCE(u.email, i.institute_email) as user_email,
        u.first_name,
        u.last_name,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), i.institute_name, 'Unknown') as user_name
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN institutes i ON al.user_id = i.id
      WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL ${ACTIVITY_LOG_RETENTION_MONTHS} MONTH)
    `;

    const params = [];

    // Add search functionality
    if (searchTerm && searchTerm.trim() !== '') {
      query += ` AND (
        u.email LIKE ? 
        OR i.institute_email LIKE ?
        OR u.first_name LIKE ? 
        OR u.last_name LIKE ?
        OR i.institute_name LIKE ?
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
      LEFT JOIN institutes i ON al.user_id = i.id
      WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL ${ACTIVITY_LOG_RETENTION_MONTHS} MONTH)
    `;

    const params = [];

    // Add search functionality
    if (searchTerm && searchTerm.trim() !== '') {
      query += ` AND (
        u.email LIKE ? 
        OR i.institute_email LIKE ?
        OR u.first_name LIKE ? 
        OR u.last_name LIKE ?
        OR i.institute_name LIKE ?
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

const deleteOldLogs = async () => {
  try {
    const query = `
      DELETE FROM activity_logs 
      WHERE created_at < DATE_SUB(NOW(), INTERVAL ${ACTIVITY_LOG_RETENTION_MONTHS} MONTH)
    `;
    const [result] = await db.query(query);
    if (result.affectedRows > 0) {
      console.log(`Auto-cleaned ${result.affectedRows} old activity logs.`);
    }
    return result.affectedRows;
  } catch (error) {
    console.error('Error deleting old activity logs:', error);
    return 0;
  }
};

module.exports = {
  createLog,
  getLogsLast3Months,
  countLogsLast3Months,
  deleteOldLogs,
};
