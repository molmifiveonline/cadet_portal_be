const jwt = require('jsonwebtoken');

/**
 * Middleware to verify JWT token and attach user to request
 */
const authMiddleware = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res
        .status(401)
        .json({ message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

/**
 * Middleware to check if user has required role(s)
 * @param {string|string[]} allowedRoles - Single role or array of allowed roles
 * @returns {Function} Express middleware function
 *
 * Usage:
 * - checkRole('SuperAdmin') - Only SuperAdmin can access
 * - checkRole(['SuperAdmin', 'Trainer']) - SuperAdmin or Trainer can access
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
