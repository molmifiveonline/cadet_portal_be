const cadetDao = require('../dao/cadetDao');

/**
 * Shortlisting Criteria for Cadets:
 * - 10th Average % >= 85%
 * - 10th Std Maths >= 80%
 * - 10th Std Science >= 80%
 * - 10th Std English >= 80%
 * - 12th Average % >= 80%
 * - 12th Std English >= 75%
 * - 12th Std Physics >= 75%
 * - 12th Std Chemistry >= 75%
 * - 12th Std Maths >= 75%
 * - IMU Rank <= 3000
 * - BMI < 25
 */

const SHORTLIST_CRITERIA = {
  tenth_avg_percentage: 85,
  tenth_std_maths: 80,
  tenth_std_science: 80,
  tenth_std_english: 80,
  twelfth_pcm_avg_percentage: 80,
  twelfth_std_english: 75,
  twelfth_std_physics: 75,
  twelfth_std_chemistry: 75,
  twelfth_std_maths: 75,
  imu_rank_max: 3000,
  bmi_max: 25,
};

/**
 * Check if a cadet meets all shortlisting criteria
 * @param {Object} cadetData - Cadet data object
 * @returns {boolean} - True if cadet meets all criteria
 */
const checkShortlistCriteria = (cadetData) => {
  if (!cadetData) return false;

  const checks = [
    // 10th standard criteria
    parseFloat(cadetData.tenth_avg_percentage) >=
      SHORTLIST_CRITERIA.tenth_avg_percentage,
    parseFloat(cadetData.tenth_std_maths) >= SHORTLIST_CRITERIA.tenth_std_maths,
    parseFloat(cadetData.tenth_std_science) >=
      SHORTLIST_CRITERIA.tenth_std_science,
    parseFloat(cadetData.tenth_std_english) >=
      SHORTLIST_CRITERIA.tenth_std_english,

    // 12th standard criteria
    parseFloat(cadetData.twelfth_pcm_avg_percentage) >=
      SHORTLIST_CRITERIA.twelfth_pcm_avg_percentage,
    parseFloat(cadetData.twelfth_std_english) >=
      SHORTLIST_CRITERIA.twelfth_std_english,
    parseFloat(cadetData.twelfth_std_physics) >=
      SHORTLIST_CRITERIA.twelfth_std_physics,
    parseFloat(cadetData.twelfth_std_chemistry) >=
      SHORTLIST_CRITERIA.twelfth_std_chemistry,
    parseFloat(cadetData.twelfth_std_maths) >=
      SHORTLIST_CRITERIA.twelfth_std_maths,

    // IMU and BMI criteria
    parseInt(cadetData.imu_rank) <= SHORTLIST_CRITERIA.imu_rank_max,
    parseFloat(cadetData.bmi) < SHORTLIST_CRITERIA.bmi_max,
  ];

  // All criteria must be met (AND logic)
  return checks.every((check) => check === true);
};

/**
 * Get shortlisted cadets with optional filters
 * @param {number} limit - Pagination limit
 * @param {number} offset - Pagination offset
 * @param {Object} filters - Filter object (instituteId, search)
 * @returns {Object} - { data: cadets[], total: number }
 */
const getShortlistedCadets = async (limit = 10, offset = 0, filters = {}) => {
  try {
    const result = await cadetDao.getShortlistedCadets(limit, offset, filters);
    return result;
  } catch (error) {
    console.error('Error in getShortlistedCadets service:', error);
    throw error;
  }
};

/**
 * Get shortlist count grouped by institute
 * @returns {Array} - Array of { institute_id, institute_name, count }
 */
const getShortlistCountByInstitute = async () => {
  try {
    const counts = await cadetDao.getShortlistCountByInstitute();
    return counts;
  } catch (error) {
    console.error('Error in getShortlistCountByInstitute service:', error);
    throw error;
  }
};

/**
 * Get shortlist statistics
 * @returns {Object} - Overall statistics
 */
const getShortlistStats = async () => {
  try {
    const instituteCounts = await getShortlistCountByInstitute();
    const totalShortlisted = instituteCounts.reduce(
      (sum, item) => sum + item.count,
      0,
    );

    return {
      total_shortlisted: totalShortlisted,
      institutes: instituteCounts,
    };
  } catch (error) {
    console.error('Error in getShortlistStats service:', error);
    throw error;
  }
};

module.exports = {
  checkShortlistCriteria,
  getShortlistedCadets,
  getShortlistCountByInstitute,
  getShortlistStats,
  SHORTLIST_CRITERIA,
};
