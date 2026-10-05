const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { ensurePasswordResetSupport } = require('../services/schemaUpgradeService');
const {
  PASSWORD_RESET_EXPIRY_MINUTES,
  PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS,
  PASSWORD_RESET_REQUEST_LIMIT,
  PASSWORD_RESET_REQUEST_WINDOW_HOURS,
} = require('../services/passwordResetService');

const findUserByEmail = async (email) => {
  const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0];
};

const findUserById = async (id) => {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0];
};

const createUser = async (userData) => {
  const { email, password, role, first_name, last_name } = userData;
  const id = uuidv4();

  await db.query(
    `INSERT INTO users (id, email, password, role, first_name, last_name) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, email, password, role || 'admin', first_name || '', last_name || ''],
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
  await ensurePasswordResetSupport();
  const [result] = await db.query(
    `UPDATE users SET password = ?, password_reset_token_hash = NULL,
       password_reset_expires_at = NULL, password_reset_requested_at = NULL
     WHERE id = ?`,
    [hashedPassword, id],
  );
  return result.affectedRows > 0;
};

const issuePasswordResetToken = async (id, tokenHash) => {
  await ensurePasswordResetSupport();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    // Serialize requests for the same account across all backend instances.
    const [users] = await connection.query(
      `SELECT id FROM users WHERE id = ?
       AND CAST(status AS CHAR) IN ('active', '1') FOR UPDATE`,
      [id],
    );
    if (!users.length) {
      await connection.commit();
      return { issued: false };
    }
    const [counts] = await connection.query(
      `SELECT COUNT(*) AS request_count,
         CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3),
           DATE_ADD(MIN(requested_at), INTERVAL ? HOUR)) / 1000000) AS retry_after_seconds
       FROM password_reset_requests
       WHERE user_id = ?
         AND requested_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? HOUR)`,
      [PASSWORD_RESET_REQUEST_WINDOW_HOURS, id, PASSWORD_RESET_REQUEST_WINDOW_HOURS],
    );
    if (counts[0].request_count >= PASSWORD_RESET_REQUEST_LIMIT) {
      await connection.commit();
      return {
        issued: false,
        limitReached: true,
        retryAfterSeconds: Math.max(1, Number(counts[0].retry_after_seconds)),
      };
    }
    const [result] = await connection.query(
      `UPDATE users
       SET password_reset_token_hash = ?,
           password_reset_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE),
           password_reset_requested_at = UTC_TIMESTAMP(3)
       WHERE id = ?
         AND (password_reset_requested_at IS NULL
           OR password_reset_requested_at <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
      [tokenHash, PASSWORD_RESET_EXPIRY_MINUTES, id, PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS],
    );
    if (result.affectedRows === 1) {
      // Reserve before sending mail so simultaneous requests cannot exceed the limit.
      await connection.query(
        'INSERT INTO password_reset_requests (token_hash, user_id, requested_at) VALUES (?, ?, UTC_TIMESTAMP(3))',
        [tokenHash, id],
      );
      await connection.query(
        `DELETE FROM password_reset_requests WHERE user_id = ?
         AND requested_at <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? HOUR)`,
        [id, PASSWORD_RESET_REQUEST_WINDOW_HOURS],
      );
    }
    await connection.commit();
    return { issued: result.affectedRows === 1 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const findUserByPasswordResetToken = async (tokenHash) => {
  await ensurePasswordResetSupport();
  const [rows] = await db.query(
    `SELECT id, email FROM users
     WHERE password_reset_token_hash = ?
       AND password_reset_expires_at > UTC_TIMESTAMP(3)
       AND CAST(status AS CHAR) IN ('active', '1')`,
    [tokenHash],
  );
  return rows[0];
};

const consumePasswordResetToken = async (id, tokenHash, hashedPassword) => {
  await ensurePasswordResetSupport();
  // Checking and consuming the token in one UPDATE prevents concurrent reuse.
  const [result] = await db.query(
    `UPDATE users
     SET password = ?, password_reset_token_hash = NULL,
         password_reset_expires_at = NULL, password_reset_requested_at = NULL
     WHERE id = ? AND password_reset_token_hash = ?
       AND password_reset_expires_at > UTC_TIMESTAMP(3)
       AND CAST(status AS CHAR) IN ('active', '1')`,
    [hashedPassword, id, tokenHash],
  );
  return result.affectedRows === 1;
};

const revokePasswordResetToken = async (id, tokenHash) => {
  await ensurePasswordResetSupport();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
    await connection.query(
      `UPDATE users SET password_reset_token_hash = NULL,
         password_reset_expires_at = NULL, password_reset_requested_at = NULL
       WHERE id = ? AND password_reset_token_hash = ?`,
      [id, tokenHash],
    );
    // Failed delivery releases only its own reservation, even if a newer link exists.
    await connection.query(
      'DELETE FROM password_reset_requests WHERE user_id = ? AND token_hash = ?',
      [id, tokenHash],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  createCandidateProfile,
  updateUserPassword,
  issuePasswordResetToken,
  findUserByPasswordResetToken,
  consumePasswordResetToken,
  revokePasswordResetToken,
};
