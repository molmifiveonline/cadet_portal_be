const jwt = require('jsonwebtoken');
const { JWT_SECRET, ROLES } = require('../config/constants');
const userDao = require('../dao/userDao');
const instituteDao = require('../dao/instituteDao');

/**
 * Middleware to verify JWT token and attach user to request
 */
const authMiddleware = async (req, res, next) => {
  try {
    const token =
      req.header('Authorization')?.replace('Bearer ', '') || req.query.token;

    if (!token) {
      return res
        .status(401)
        .json({ message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user/institute status in database
    if (decoded.role === ROLES.INSTITUTE) {
      const institute = await instituteDao.getInstituteById(decoded.id);
      if (!institute) {
        return res.status(403).json({ message: 'Institute account not found' });
      }
      // Check for expiry again
      if (new Date() > new Date(institute.temp_expiry)) {
        return res
          .status(403)
          .json({ message: 'Institute credentials have expired' });
      }
    } else {
      const user = await userDao.findUserById(decoded.id);
      if (!user) {
        return res.status(403).json({ message: 'User account not found' });
      }

      const status = String(user.status).toLowerCase();
      if (status !== '1' && status !== 'active' && user.status !== true) {
        return res.status(403).json({ message: 'Account is inactive' });
      }
    }

    req.user = decoded;
    next();
  } catch (error) {
    // For debugging:
    console.error('JWT Verification Error:', error.name, error.message);
    res.status(401).json({
      message: 'Invalid token',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      code: error.name,
    });
  }
};

/**
 * Middleware to check if user has required role(s)
 * @param {string|string[]} allowedRoles - Single role or array of allowed roles
 * @returns {Function} Express middleware function
 *
 * Usage:
 * - checkRole('SuperAdmin') - Only SuperAdmin can access
 * - checkRole(['SuperAdmin', 'Institute']) - SuperAdmin or Institute can access
 */
const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          message: 'Authentication required',
          success: false,
        });
      }

      const userRole = req.user.role;
      const rolesArray = Array.isArray(allowedRoles)
        ? allowedRoles
        : [allowedRoles];

      console.log(
        `DEBUG: checkRole audit - URL: ${req.originalUrl}, required: ${rolesArray}, user: ${userRole}`,
      );

      if (!rolesArray.includes(userRole)) {
        return res.status(403).json({
          message: 'Access denied. Insufficient permissions.',
          success: false,
          requiredRole: rolesArray,
          userRole: userRole,
        });
      }

      next();
    } catch (error) {
      res.status(500).json({
        message: 'Error checking permissions',
        success: false,
      });
    }
  };
};

module.exports = {
  authMiddleware,
  checkRole,
};
