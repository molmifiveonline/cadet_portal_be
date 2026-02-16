const crypto = require('crypto');
const db = require('../config/database');

/**
 * CV Token DAO - Manages CV form access tokens
 */

/**
 * Generate a unique secure token
 */
const generateSecureToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Create a new CV token for a cadet
 * @param {string} cadetId - Cadet ID
 * @param {string} instituteId - Institute ID
 * @param {number} expirationDays - Days until token expires (default: 7)
 * @returns {Object} Token data
 */
const createCVToken = async (cadetId, instituteId, expirationDays = 7) => {
  const token = generateSecureToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expirationDays);

  const query = `
    INSERT INTO cv_tokens (id, cadet_id, institute_id, token, expires_at, status)
    VALUES (UUID(), ?, ?, ?, ?, 'active')
  `;

  await db.query(query, [cadetId, instituteId, token, expiresAt]);

  return {
    token,
    cadet_id: cadetId,
    institute_id: instituteId,
    expires_at: expiresAt,
    status: 'active',
  };
};

/**
 * Get token details by token string
 * @param {string} token - Token string
 * @returns {Object|null} Token data or null
 */
const getTokenByString = async (token) => {
  const query = `
    SELECT 
      t.*,
      c.name as cadet_name,
      c.email as cadet_email,
      i.institute_name,
      i.email as institute_email
    FROM cv_tokens t
    LEFT JOIN cadets c ON t.cadet_id = c.id
    LEFT JOIN institutes i ON t.institute_id = i.id
    WHERE t.token = ?
  `;

  const [rows] = await db.query(query, [token]);
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Validate if a token is active and not expired
 * @param {string} token - Token string
 * @returns {Object} Validation result {valid: boolean, message: string, data: Object}
 */
const validateToken = async (token) => {
  const tokenData = await getTokenByString(token);

  if (!tokenData) {
    return {
      valid: false,
      message: 'Invalid token',
      data: null,
    };
  }

  if (tokenData.status !== 'active') {
    return {
      valid: false,
      message: `Token is ${tokenData.status}`,
      data: tokenData,
    };
  }

  const now = new Date();
  const expiresAt = new Date(tokenData.expires_at);

  if (now > expiresAt) {
    // Auto-expire the token
    await updateTokenStatus(token, 'expired');
    return {
      valid: false,
      message: 'Token has expired',
      data: tokenData,
    };
  }

  return {
    valid: true,
    message: 'Token is valid',
    data: tokenData,
  };
};

/**
 * Mark token as used
 * @param {string} token - Token string
 */
const markTokenAsUsed = async (token) => {
  const query = `
    UPDATE cv_tokens
    SET status = 'used', used_at = NOW()
    WHERE token = ?
  `;

  await db.query(query, [token]);
};

/**
 * Update token status
 * @param {string} token - Token string
 * @param {string} status - New status ('active', 'used', 'expired')
 */
const updateTokenStatus = async (token, status) => {
  const query = `
    UPDATE cv_tokens
    SET status = ?
    WHERE token = ?
  `;

  await db.query(query, [status, token]);
};

/**
 * Get all active tokens for a cadet
 * @param {string} cadetId - Cadet ID
 * @returns {Array} Array of token records
 */
const getTokensByCadet = async (cadetId) => {
  const query = `
    SELECT * FROM cv_tokens
    WHERE cadet_id = ?
    ORDER BY created_at DESC
  `;

  const [rows] = await db.query(query, [cadetId]);
  return rows;
};

/**
 * Revoke/expire all active tokens for a cadet
 * @param {string} cadetId - Cadet ID
 */
const revokeAllCadetTokens = async (cadetId) => {
  const query = `
    UPDATE cv_tokens
    SET status = 'expired'
    WHERE cadet_id = ? AND status = 'active'
  `;

  await db.query(query, [cadetId]);
};

/**
 * Get all tokens for an institute
 * @param {string} instituteId - Institute ID
 * @returns {Array} Array of token records with cadet info
 */
const getTokensByInstitute = async (instituteId) => {
  const query = `
    SELECT 
      t.*,
      c.name as cadet_name,
      c.email as cadet_email
    FROM cv_tokens t
    LEFT JOIN cadets c ON t.cadet_id = c.id
    WHERE t.institute_id = ?
    ORDER BY t.created_at DESC
  `;

  const [rows] = await db.query(query, [instituteId]);
  return rows;
};

/**
 * Delete expired tokens (cleanup job)
 * @param {number} daysOld - Delete tokens older than this many days
 */
const deleteExpiredTokens = async (daysOld = 30) => {
  const query = `
    DELETE FROM cv_tokens
    WHERE status = 'expired' 
    AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
  `;

  const [result] = await db.query(query, [daysOld]);
  return result.affectedRows;
};

module.exports = {
  createCVToken,
  getTokenByString,
  validateToken,
  markTokenAsUsed,
  updateTokenStatus,
  getTokensByCadet,
  revokeAllCadetTokens,
  getTokensByInstitute,
  deleteExpiredTokens,
};
