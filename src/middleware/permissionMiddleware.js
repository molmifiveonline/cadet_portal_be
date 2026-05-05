const rolePermissionDao = require('../dao/rolePermissionDao');

/* PERMISSION MIDDLEWARE
 * Checks if user has required permission to access route
 */

/* Middleware to check if user has specific permission */
const requirePermission = (module, action) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      // Super Admin always has access
      if (user.role === 'SuperAdmin') {
        return next();
      }

      // Check if user has the required permission
      const hasPermission = await rolePermissionDao.userHasPermission(
        user.role,
        module,
        action,
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to perform this action',
          required: { module, action },
        });
      }

      next();
    } catch (error) {
      console.error('Permission Check Error:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking permissions',
        error: error.message,
      });
    }
  };
};

/* Middleware to check if user has ANY of the specified permissions */
const requireAnyPermission = (permissionPairs) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      // Super Admin always has access
      if (user.role === 'SuperAdmin') {
        return next();
      }

      // Check if user has any of the required permissions
      const checks = await Promise.all(
        permissionPairs.map(([module, action]) =>
          rolePermissionDao.userHasPermission(user.role, module, action),
        ),
      );

      const hasAnyPermission = checks.some((result) => result === true);

      if (!hasAnyPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to perform this action',
          required: permissionPairs,
        });
      }

      next();
    } catch (error) {
      console.error('Permission Check Error:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking permissions',
        error: error.message,
      });
    }
  };
};

/* Middleware to restrict access to Super Admin only */
const requireSuperAdmin = (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (user.role !== 'SuperAdmin') {
      return res.status(403).json({
        success: false,
        message: 'This action is restricted to Super Administrators only',
      });
    }

    next();
  } catch (error) {
    console.error('Super Admin Check Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking admin status',
      error: error.message,
    });
  }
};

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
};
