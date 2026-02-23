const cvTokenDao = require('../dao/cvTokenDao');

/**
 * CV Token Service - Business logic for managing CV form tokens
 */

/**
 * Generate CV token for a shortlisted cadet
 * @param {string} cadetId - Cadet ID
 * @param {string} instituteId - Institute ID
 * @param {number} expirationDays - Days until expiration (default: 7)
 * @returns {Object} Token data
 */
const generateCVToken = async (cadetId, instituteId, expirationDays = 7) => {
  try {
    // Revoke any existing active tokens for this cadet
    await cvTokenDao.revokeAllCadetTokens(cadetId);

    // Create new token
    const tokenData = await cvTokenDao.createCVToken(
      cadetId,
      instituteId,
      expirationDays,
    );

    return tokenData;
  } catch (error) {
    console.error('Error generating CV token:', error);
    throw error;
  }
};

/**
 * Generate tokens for multiple cadets (bulk operation)
 * @param {Array} cadets - Array of {cadetId, instituteId}
 * @param {number} expirationDays - Days until expiration
 * @returns {Array} Array of token data
 */
const generateBulkCVTokens = async (cadets, expirationDays = 7) => {
  try {
    const tokens = [];

    for (const { cadetId, instituteId } of cadets) {
      const tokenData = await generateCVToken(
        cadetId,
        instituteId,
        expirationDays,
      );
      tokens.push(tokenData);
    }

    return tokens;
  } catch (error) {
    console.error('Error generating bulk CV tokens:', error);
    throw error;
  }
};

/**
 * Validate a CV token
 * @param {string} token - Token string
 * @returns {Object} Validation result
 */
const validateCVToken = async (token) => {
  try {
    const validationResult = await cvTokenDao.validateToken(token);
    return validationResult;
  } catch (error) {
    console.error('Error validating CV token:', error);
    throw error;
  }
};

/**
 * Mark token as used after successful CV form submission
 * @param {string} token - Token string
 */
const markTokenUsed = async (token) => {
  try {
    await cvTokenDao.markTokenAsUsed(token);
  } catch (error) {
    console.error('Error marking token as used:', error);
    throw error;
  }
};

/**
 * Get token details with cadet and institute info
 * @param {string} token - Token string
 * @returns {Object|null} Token data or null
 */
const getTokenDetails = async (token) => {
  try {
    const tokenData = await cvTokenDao.getTokenByString(token);
    return tokenData;
  } catch (error) {
    console.error('Error getting token details:', error);
    throw error;
  }
};

/**
 * Get all tokens for a cadet
 * @param {string} cadetId - Cadet ID
 * @returns {Array} Array of tokens
 */
const getCadetTokens = async (cadetId) => {
  try {
    const tokens = await cvTokenDao.getTokensByCadet(cadetId);
    return tokens;
  } catch (error) {
    console.error('Error getting cadet tokens:', error);
    throw error;
  }
};

/**
 * Get all tokens for an institute
 * @param {string} instituteId - Institute ID
 * @returns {Array} Array of tokens with cadet info
 */
const getInstituteTokens = async (instituteId) => {
  try {
    const tokens = await cvTokenDao.getTokensByInstitute(instituteId);
    return tokens;
  } catch (error) {
    console.error('Error getting institute tokens:', error);
    throw error;
  }
};

/**
 * Regenerate/resend token for a cadet
 * @param {string} cadetId - Cadet ID
 * @param {string} instituteId - Institute ID
 * @returns {Object} New token data
 */
const regenerateToken = async (cadetId, instituteId) => {
  try {
    // This will revoke old tokens and create a new one
    const tokenData = await generateCVToken(cadetId, instituteId, 7);
    return tokenData;
  } catch (error) {
    console.error('Error regenerating token:', error);
    throw error;
  }
};

module.exports = {
  generateCVToken,
  generateBulkCVTokens,
  validateCVToken,
  markTokenUsed,
  getTokenDetails,
  getCadetTokens,
  getInstituteTokens,
  regenerateToken,
};
