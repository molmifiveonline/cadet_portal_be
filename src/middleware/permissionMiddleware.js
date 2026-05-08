const rolePermissionDao = require('../dao/rolePermissionDao');
const { ROLES } = require('../config/constants');

// Cache for permission checks
// Cache TTL: 120 seconds
const permissionCache = new Map();
const CACHE_TTL = 120 * 1000;

const getCachedPermission = async (roleName, moduleName, action) => {
  const cacheKey = `${roleName}:${moduleName}:${action}`;
  const cached = permissionCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  const result = await rolePermissionDao.userHasPermission(
    roleName,
    moduleName,
    action,
  );

  permissionCache.set(cacheKey, {
    result,
    timestamp: Date.now(),
  });

  return result;
};

/**
 * Middleware to check if user has a specific permission
 * @param {string} moduleName - The module name (e.g., 'cadets')
 * @param {string} action - The action (e.g., 'view', 'edit', 'delete')
 */
const requirePermission = (moduleName, action) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // SuperAdmin has all permissions
      if (user.role === ROLES.SUPER_ADMIN || user.role === 'SuperAdmin') {
        return next();
      }

      // Check permissions (with caching)
      const hasPermission = await getCachedPermission(
        user.role,
        moduleName,
        action,
      );

      if (!hasPermission) {
        return res
          .status(403)
          .json({ message: `Access denied for ${action} on ${moduleName}` });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ message: 'Error checking permissions' });
    }
  };
};

/**
 * Middleware to check if user has any of the specified permissions
 * @param {Array<[string, string]>} permissions - Array of [moduleName, action]
 */
const requireAnyPermission = (permissions) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // SuperAdmin has all permissions
      if (user.role === ROLES.SUPER_ADMIN || user.role === 'SuperAdmin') {
        return next();
      }

      // Check each permission (with caching)
      for (const [moduleName, action] of permissions) {
        const hasPermission = await getCachedPermission(
          user.role,
          moduleName,
          action,
        );
        if (hasPermission) {
          return next();
        }
      }

      res.status(403).json({ message: 'Access denied' });
    } catch (error) {
      console.error('Any permission check error:', error);
      res.status(500).json({ message: 'Error checking permissions' });
    }
  };
};

const requireSuperAdmin = (req, res, next) => {
  const user = req.user;
  if (user && (user.role === ROLES.SUPER_ADMIN || user.role === 'SuperAdmin')) {
    return next();
  }
  return res.status(403).json({ message: 'SuperAdmin access required' });
};

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
};
