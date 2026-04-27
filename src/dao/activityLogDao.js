const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { ACTIVITY_LOG_RETENTION_MONTHS } = require('../config/constants');

const UUID_PATTERN =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const CADET_ACTIVITY_PATTERN = new RegExp(
  `^(Assessment|Interview|Medical result) for cadet ID (${UUID_PATTERN}) has been (saved|deleted)\\.$`,
);
const IMPORT_ACTIVITY_PATTERN = new RegExp(
  `^Imported (\\d+) cadets from submission (${UUID_PATTERN})(?: for drive (${UUID_PATTERN}))?$`,
);

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

const getEntityLabelMap = async (tableName, labelColumn, ids = []) => {
  if (!ids.length) {
    return new Map();
  }

  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT id, ${labelColumn} AS label FROM ${tableName} WHERE id IN (${placeholders})`,
    ids,
  );

  return new Map(
    rows
      .filter((row) => row.id && row.label)
      .map((row) => [row.id, row.label]),
  );
};

const enrichLogDetails = async (rows = []) => {
  if (!rows.length) {
    return rows;
  }

  const cadetIds = new Set();
  const driveIds = new Set();
  const submissionIds = new Set();

  rows.forEach((row) => {
    const details = row?.details || '';
    const cadetMatch = details.match(CADET_ACTIVITY_PATTERN);
    if (cadetMatch) {
      cadetIds.add(cadetMatch[2]);
    }

    const importMatch = details.match(IMPORT_ACTIVITY_PATTERN);
    if (importMatch) {
      submissionIds.add(importMatch[2]);
      if (importMatch[3]) {
        driveIds.add(importMatch[3]);
      }
    }
  });

  if (!cadetIds.size && !driveIds.size && !submissionIds.size) {
    return rows;
  }

  const [cadetMap, driveMap, submissionMap] = await Promise.all([
    getEntityLabelMap('cadets', 'name_as_in_indos_cert', [...cadetIds]),
    getEntityLabelMap('recruitment_drives', 'drive_name', [...driveIds]),
    getEntityLabelMap('institute_submissions', 'original_name', [...submissionIds]),
  ]);

  return rows.map((row) => {
    const details = row?.details || '';

    const cadetMatch = details.match(CADET_ACTIVITY_PATTERN);
    if (cadetMatch) {
      const [, activityType, cadetId, activityState] = cadetMatch;
      const cadetName = cadetMap.get(cadetId);

      if (cadetName) {
        return {
          ...row,
          details: `${activityType} for cadet ${cadetName} has been ${activityState}.`,
        };
      }
    }

    const importMatch = details.match(IMPORT_ACTIVITY_PATTERN);
    if (importMatch) {
      const [, count, submissionId, driveId] = importMatch;
      const submissionName = submissionMap.get(submissionId);
      const driveName = driveId ? driveMap.get(driveId) : null;

      if (submissionName || driveName) {
        let formattedDetails = `Imported ${count} cadets from submission ${
          submissionName || submissionId
        }`;

        if (driveId) {
          formattedDetails += ` for drive ${driveName || driveId}`;
        }

        return {
          ...row,
          details: formattedDetails,
        };
      }
    }

    return row;
  });
};

const getLogsLast3Months = async (
  limit,
  offset,
  searchTerm = '',
  sortBy = 'created_at',
  sortOrder = 'DESC',
) => {
  try {
    let query = `
      SELECT 
        al.id,
        al.action,
        al.details,
        al.created_at,
        COALESCE(u.email, JSON_UNQUOTE(JSON_EXTRACT(i.contact_emails, '$[0].email'))) as user_email,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), i.institute_name, 'Unknown') as display_name,
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
        OR i.contact_emails LIKE ?
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

    // Define allowed sorting columns to prevent SQL injection
    const allowedSortColumns = {
      id: 'al.id',
      display_name: 'display_name',
      user_name: 'display_name',
      action: 'al.action',
      details: 'al.details',
      created_at: 'al.created_at',
    };

    const sortColumn = allowedSortColumns[sortBy] || 'al.created_at';
    const order =
      sortOrder && sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortColumn} ${order}`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [rows] = await db.query(query, params);
    return enrichLogDetails(rows);
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
        OR i.contact_emails LIKE ?
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
