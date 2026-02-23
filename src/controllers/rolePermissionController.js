const rolePermissionDao = require('../dao/rolePermissionDao');
const activityLogDao = require('../dao/activityLogDao');

/* Get all roles */
const getAllRoles = async (req, res) => {
  try {
    const roles = await rolePermissionDao.getAllRoles();
    res.json({
      success: true,
      data: roles,
    });
  } catch (error) {
    console.error('Get All Roles Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch roles',
      error: error.message,
    });
  }
};

/* Get role by ID */
const getRoleById = async (req, res) => {
  try {
    const { roleId } = req.params;
    const role = await rolePermissionDao.getRoleById(roleId);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    res.json({
      success: true,
      data: role,
    });
  } catch (error) {
    console.error('Get Role By ID Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch role',
      error: error.message,
    });
  }
};

/* Get all permissions */
const getAllPermissions = async (req, res) => {
  try {
    const permissions = await rolePermissionDao.getAllPermissions();
    res.json({
      success: true,
      data: permissions,
    });
  } catch (error) {
    console.error('Get All Permissions Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch permissions',
      error: error.message,
    });
  }
};

/* Get permissions grouped by module */
const getPermissionsByModule = async (req, res) => {
  try {
    const permissions = await rolePermissionDao.getPermissionsByModule();
    res.json({
      success: true,
      data: permissions,
    });
  } catch (error) {
    console.error('Get Permissions By Module Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch permissions',
      error: error.message,
    });
  }
};

/* Get permissions for a specific role */
const getRolePermissions = async (req, res) => {
  try {
    const { roleId } = req.params;
    const permissions =
      await rolePermissionDao.getRolePermissionsByModule(roleId);

    res.json({
      success: true,
      data: permissions,
    });
  } catch (error) {
    console.error('Get Role Permissions Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch role permissions',
      error: error.message,
    });
  }
};

/* Update permissions for a role */
const updateRolePermissions = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        message: 'Permissions must be an array',
      });
    }

    // Validate role exists
    const role = await rolePermissionDao.getRoleById(roleId);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    // Update permissions
    await rolePermissionDao.updateRolePermissions(roleId, permissions);

    // Log activity
    const user = req.user;
    if (user) {
      await activityLogDao.createLog(
        user.id,
        'PERMISSION_UPDATE',
        `Updated permissions for role: ${role.display_name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      success: true,
      message: 'Permissions updated successfully',
    });
  } catch (error) {
    console.error('Update Role Permissions Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update permissions',
      error: error.message,
    });
  }
};

/* Set a single permission for a role */
const setRolePermission = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissionId, granted } = req.body;

    if (!permissionId || typeof granted !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Permission ID and granted status are required',
      });
    }

    const success = await rolePermissionDao.setRolePermission(
      roleId,
      permissionId,
      granted,
    );

    if (success) {
      // Log activity
      const user = req.user;
      if (user) {
        await activityLogDao.createLog(
          user.id,
          'PERMISSION_CHANGE',
          `${granted ? 'Granted' : 'Revoked'} permission for role`,
          req.ip || req.connection.remoteAddress,
        );
      }

      res.json({
        success: true,
        message: 'Permission updated successfully',
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to update permission',
      });
    }
  } catch (error) {
    console.error('Set Role Permission Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set permission',
      error: error.message,
    });
  }
};

/* Check if user has specific permission */
const checkUserPermission = async (req, res) => {
  try {
    const user = req.user;
    const { module, action } = req.query;

    if (!module || !action) {
      return res.status(400).json({
        success: false,
        message: 'Module and action are required',
      });
    }

    const hasPermission = await rolePermissionDao.userHasPermission(
      user.role,
      module,
      action,
    );

    res.json({
      success: true,
      hasPermission,
    });
  } catch (error) {
    console.error('Check User Permission Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check permission',
      error: error.message,
    });
  }
};

/* Get current user's permissions */
const getCurrentUserPermissions = async (req, res) => {
  try {
    const user = req.user;
    // Use role name from token to avoid joining users table and potential collation issues
    const permissions = await rolePermissionDao.getPermissionsByRoleName(
      user.role,
    );

    res.json({
      success: true,
      data: permissions,
    });
  } catch (error) {
    console.error('Get Current User Permissions Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user permissions',
      error: error.message,
    });
  }
};

module.exports = {
  // Roles
  getAllRoles,
  getRoleById,

  // Permissions
  getAllPermissions,
  getPermissionsByModule,

  // Role Permissions
  getRolePermissions,
  updateRolePermissions,
  setRolePermission,
  checkUserPermission,
  getCurrentUserPermissions,
};
