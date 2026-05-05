const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const bcrypt = require('bcryptjs');
const {
  filterExistingColumns,
  hasColumn,
} = require('../services/schemaCompatibilityService');

const createInstitute = async (instituteData) => {
  const {
    institute_name,
    address,
    location,
    institute_type,
    contact_emails,
    status = 'active',
  } = instituteData;
  const id = uuidv4();

  await db.query(
    `INSERT INTO institutes (id, institute_name, address, location, institute_type, contact_emails, status) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      institute_name,
      address,
      location,
      institute_type || null,
      contact_emails ? JSON.stringify(contact_emails) : null,
      status,
    ],
  );
  return id;
};

const getAllInstitutes = async (
  limit,
  offset,
  sortBy,
  sortOrder,
  search,
  hasSubmissions = false,
) => {
  let query = 'SELECT DISTINCT i.* FROM institutes i';
  let countQuery = 'SELECT COUNT(DISTINCT i.id) as total FROM institutes i';
  let queryParams = [];
  let countParams = [];

  if (hasSubmissions) {
    // Only return institutes that have cadets in the system (i.e. present in the table)
    query += ' JOIN cadets c ON i.id = c.institute_id';
    countQuery += ' JOIN cadets c ON i.id = c.institute_id';
  }

  if (search) {
    const searchPattern = `%${search}%`;

    const whereClause = ` WHERE (
      i.institute_name LIKE ? OR 
      i.address LIKE ? OR 
      i.location LIKE ? OR
      i.institute_type LIKE ? OR
      i.contact_emails LIKE ?
    )`;

    query += whereClause;
    countQuery += whereClause;
    const searchParams = [
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
    ];
    queryParams.push(...searchParams);
    countParams.push(...searchParams);
  }

  query += ` ORDER BY i.${sortBy} ${sortOrder}`;

  // Only apply limit/offset if they are valid numbers (not -1 for "all")
  if (limit && limit > 0) {
    query += ' LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);
  }

  const [rows] = await db.query(query, queryParams);
  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data: rows, total };
};

const getInstituteById = async (id) => {
  const [rows] = await db.query('SELECT * FROM institutes WHERE id = ?', [id]);
  return rows[0];
};

const normalizeEmail = (email) =>
  typeof email === 'string' ? email.trim().toLowerCase() : '';

const parseContactEmails = (contactEmails) => {
  if (Array.isArray(contactEmails)) {
    return contactEmails;
  }

  if (typeof contactEmails === 'string') {
    try {
      const parsed = JSON.parse(contactEmails);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  return [];
};

const getInstituteByContactEmails = async (emails, excludeId = null) => {
  const normalizedEmails = [
    ...new Set((emails || []).map(normalizeEmail).filter(Boolean)),
  ];

  if (normalizedEmails.length === 0) {
    return null;
  }

  let query =
    'SELECT id, institute_name, contact_emails FROM institutes WHERE contact_emails IS NOT NULL';
  const params = [];

  if (excludeId) {
    query += ' AND id <> ?';
    params.push(excludeId);
  }

  const [rows] = await db.query(query, params);
  const emailSet = new Set(normalizedEmails);

  for (const row of rows) {
    const contactEmails = parseContactEmails(row.contact_emails);
    const duplicateEmail = contactEmails
      .map((contact) =>
        normalizeEmail(
          typeof contact === 'string' ? contact : contact && contact.email,
        ),
      )
      .find((email) => emailSet.has(email));

    if (duplicateEmail) {
      return {
        ...row,
        duplicate_email: duplicateEmail,
      };
    }
  }

  return null;
};

const updateInstitute = async (id, instituteData) => {
  const {
    institute_name,
    address,
    location,
    institute_type,
    contact_emails,
    status,
  } = instituteData;

  const [result] = await db.query(
    `UPDATE institutes 
     SET institute_name = ?, address = ?, location = ?, institute_type = ?, contact_emails = ?, status = COALESCE(?, status)
     WHERE id = ?`,
    [
      institute_name,
      address,
      location,
      institute_type || null,
      contact_emails ? JSON.stringify(contact_emails) : null,
      status || null,
      id,
    ],
  );
  return result.affectedRows > 0;
};

const deleteInstitute = async (id) => {
  const [result] = await db.query('DELETE FROM institutes WHERE id = ?', [id]);
  return result.affectedRows > 0;
};

const createSubmission = async (
  instituteId,
  fileName,
  originalName,
  fileData,
  batch_year,
  course_type,
  remarks = null,
) => {
  const id = uuidv4();

  const filteredData = await filterExistingColumns('institute_submissions', {
    id,
    institute_id: instituteId,
    file_name: fileName,
    original_name: originalName,
    file_data: fileData,
    batch_year,
    course_type,
    remarks,
  });

  const fields = Object.keys(filteredData);
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map((field) => filteredData[field]);

  await db.query(
    `INSERT INTO institute_submissions (${fields.join(', ')}) VALUES (${placeholders})`,
    values,
  );
  return id;
};

const getAllSubmissions = async (
  limit = 10,
  offset = 0,
  status = 'all',
  search = '',
  instituteId = '',
  batchYear = '',
  courseType = '',
) => {
  // Exclude file_data from this query for performance
  const hasBatchYear = await hasColumn('institute_submissions', 'batch_year');
  const hasCourseType = await hasColumn('institute_submissions', 'course_type');
  const hasRemarks = await hasColumn('institute_submissions', 'remarks');
  const hasSubmissionNotifiedAt = await hasColumn(
    'institute_submissions',
    'submission_notified_at',
  );
  const selectExtras = [
    hasRemarks ? 'isub.remarks' : 'NULL AS remarks',
    hasSubmissionNotifiedAt
      ? 'isub.submission_notified_at'
      : 'NULL AS submission_notified_at',
  ].join(', ');

  let query = `
    SELECT isub.id, isub.institute_id, isub.file_name, isub.original_name, isub.status, isub.created_at,
           ${hasBatchYear ? 'isub.batch_year' : 'NULL AS batch_year'},
           ${hasCourseType ? 'isub.course_type' : 'NULL AS course_type'},
           ${selectExtras}, i.institute_name 
    FROM institute_submissions isub
    LEFT JOIN institutes i ON isub.institute_id = i.id
  `;
  let queryParams = [];
  let whereClauses = [];

  if (status !== 'all') {
    whereClauses.push('isub.status = ?');
    queryParams.push(status);
  }

  if (instituteId) {
    whereClauses.push('isub.institute_id = ?');
    queryParams.push(instituteId);
  }

  if (batchYear && hasBatchYear) {
    whereClauses.push('isub.batch_year = ?');
    queryParams.push(batchYear);
  }

  if (courseType && courseType !== 'all' && hasCourseType) {
    whereClauses.push('isub.course_type = ?');
    queryParams.push(courseType);
  }

  if (search) {
    const searchPattern = `%${search}%`;
    whereClauses.push('(i.institute_name LIKE ? OR isub.original_name LIKE ?)');
    queryParams.push(searchPattern, searchPattern);
  }

  if (whereClauses.length > 0) {
    query += ' WHERE ' + whereClauses.join(' AND ');
  }

  query += ' ORDER BY isub.created_at DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);

  let countQuery = `
    SELECT COUNT(*) as total 
    FROM institute_submissions isub
    LEFT JOIN institutes i ON isub.institute_id = i.id
  `;

  // Re-use params for count query (excluding limit/offset)
  const countParams = queryParams.slice(0, queryParams.length - 2);

  if (whereClauses.length > 0) {
    countQuery += ' WHERE ' + whereClauses.join(' AND ');
  }

  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data: rows, total };
};

const deleteSubmission = async (id) => {
  const [result] = await db.query(
    'DELETE FROM institute_submissions WHERE id = ?',
    [id],
  );
  return result.affectedRows > 0;
};

const deleteSubmissions = async (ids) => {
  if (!ids || ids.length === 0) return 0;
  // Creating a placeholder string like (?, ?, ?)
  const placeholders = ids.map(() => '?').join(',');
  const [result] = await db.query(
    `DELETE FROM institute_submissions WHERE id IN (${placeholders})`,
    ids,
  );
  return result.affectedRows;
};

const getActiveSubmissionForContext = async (
  instituteId,
  batchYear,
  courseType,
) => {
  const hasBatchYear = await hasColumn('institute_submissions', 'batch_year');
  const hasCourseType = await hasColumn('institute_submissions', 'course_type');
  const whereClauses = ['institute_id = ?', 'status <> ?'];
  const params = [instituteId, 'rejected'];

  if (batchYear && hasBatchYear) {
    whereClauses.push('batch_year = ?');
    params.push(batchYear);
  }

  if (courseType && hasCourseType) {
    whereClauses.push('course_type = ?');
    params.push(courseType);
  }

  const [rows] = await db.query(
    `SELECT id, status, created_at
     FROM institute_submissions
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 1`,
    params,
  );

  return rows[0] || null;
};

const getSubmissionById = async (id) => {
  const hasBatchYear = await hasColumn('institute_submissions', 'batch_year');
  const hasCourseType = await hasColumn('institute_submissions', 'course_type');
  const hasRemarks = await hasColumn('institute_submissions', 'remarks');
  const hasSubmissionNotifiedAt = await hasColumn(
    'institute_submissions',
    'submission_notified_at',
  );
  const [rows] = await db.query(
    `SELECT id, institute_id, file_name, original_name, status, created_at,
            ${hasBatchYear ? 'batch_year' : 'NULL AS batch_year'},
            ${hasCourseType ? 'course_type' : 'NULL AS course_type'},
            ${hasRemarks ? 'remarks' : 'NULL AS remarks'},
            ${hasSubmissionNotifiedAt ? 'submission_notified_at' : 'NULL AS submission_notified_at'}
     FROM institute_submissions
     WHERE id = ?`,
    [id],
  );
  return rows[0];
};

const getSubmissionFile = async (id) => {
  const [rows] = await db.query(
    'SELECT file_data, file_name, original_name FROM institute_submissions WHERE id = ?',
    [id],
  );
  return rows[0];
};

const updateSubmissionStatus = async (id, status) => {
  const [result] = await db.query(
    'UPDATE institute_submissions SET status = ? WHERE id = ?',
    [status, id],
  );
  return result.affectedRows > 0;
};

const markSubmissionNotified = async (id) => {
  const hasSubmissionNotifiedAt = await hasColumn(
    'institute_submissions',
    'submission_notified_at',
  );

  if (!hasSubmissionNotifiedAt) {
    return false;
  }

  const [result] = await db.query(
    'UPDATE institute_submissions SET submission_notified_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id],
  );
  return result.affectedRows > 0;
};

const updateInstituteCredentials = async (
  id,
  tempUsername,
  tempPassword,
  tempExpiry,
  batch_year,
  submission_course_type = null,
) => {
  let hashedPassword = null;
  if (tempPassword) {
    hashedPassword = await bcrypt.hash(tempPassword, 10);
  }

  const [result] = await db.query(
    `UPDATE institutes 
     SET temp_username = ?, temp_password = ?, temp_expiry = ?, batch_year = ?, submission_course_type = ?
     WHERE id = ?`,
    [
      tempUsername,
      hashedPassword,
      tempExpiry,
      batch_year,
      submission_course_type,
      id,
    ],
  );
  return result.affectedRows > 0;
};

const extendInstituteExpiry = async (id, newExpiry) => {
  const [result] = await db.query(
    'UPDATE institutes SET temp_expiry = ? WHERE id = ?',
    [newExpiry, id],
  );
  return result.affectedRows > 0;
};

const getInstituteByTempUsername = async (username) => {
  const [rows] = await db.query(
    'SELECT * FROM institutes WHERE temp_username = ?',
    [username],
  );
  return rows[0];
};

const getInstituteByEmail = async (email) => {
  const lowerEmail = email.toLowerCase().trim();
  const [rows] = await db.query(
    'SELECT * FROM institutes WHERE LOWER(contact_emails) LIKE ?',
    [`%"email":"${lowerEmail}"%`],
  );
  return rows[0];
};

const saveInstituteOtp = async (id, hashedOtp, expiresAt) => {
  const [result] = await db.query(
    'UPDATE institutes SET otp = ?, otp_expires_at = ? WHERE id = ?',
    [hashedOtp, expiresAt, id],
  );
  return result.affectedRows > 0;
};

const clearInstituteOtp = async (id) => {
  const [result] = await db.query(
    'UPDATE institutes SET otp = NULL, otp_expires_at = NULL WHERE id = ?',
    [id],
  );
  return result.affectedRows > 0;
};

module.exports = {
  createInstitute,
  getAllInstitutes,
  getInstituteById,
  getInstituteByContactEmails,
  updateInstitute,
  deleteInstitute,
  createSubmission,
  getAllSubmissions,
  deleteSubmission,
  deleteSubmissions,
  getActiveSubmissionForContext,
  getSubmissionById,
  getSubmissionFile,
  updateSubmissionStatus,
  markSubmissionNotified,
  updateInstituteCredentials,
  extendInstituteExpiry,
  getInstituteByTempUsername,
  getInstituteByEmail,
  saveInstituteOtp,
  clearInstituteOtp,
};
