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

/* Create a new role */
const createRole = async (req, res) => {
  try {
    const { name, display_name, description } = req.body;

    if (!name || !display_name) {
      return res.status(400).json({
        success: false,
        message: 'Role name and display name are required',
      });
    }

    // Check if role name already exists
    const existingRole = await rolePermissionDao.getRoleByName(name);
    if (existingRole) {
      return res.status(409).json({
        success: false,
        message: 'Role name already exists',
      });
    }

    const newRole = await rolePermissionDao.createRole({
      name,
      display_name,
      description,
    });

    if (newRole) {
      // Log activity
      const user = req.user;
      if (user) {
        await activityLogDao.createLog(
          user.id,
          'ROLE_CREATE',
          `Created new role: ${display_name}`,
          req.ip || req.connection.remoteAddress,
        );
      }

      res.status(201).json({
        success: true,
        message: 'Role created successfully',
        data: newRole,
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to create role',
      });
    }
  } catch (error) {
    console.error('Create Role Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create role',
      error: error.message,
    });
  }
};

/* Update a role */
const updateRole = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { display_name, description } = req.body;

    if (!display_name) {
      return res.status(400).json({
        success: false,
        message: 'Display name is required',
      });
    }

    // Validate role exists and is not a system role
    const role = await rolePermissionDao.getRoleById(roleId);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    if (role.is_system_role) {
      return res.status(403).json({
        success: false,
        message: 'System roles cannot be modified',
      });
    }

    const updated = await rolePermissionDao.updateRole(roleId, {
      display_name,
      description,
    });

    if (updated) {
      // Log activity
      const user = req.user;
      if (user) {
        await activityLogDao.createLog(
          user.id,
          'ROLE_UPDATE',
          `Updated role: ${display_name}`,
          req.ip || req.connection.remoteAddress,
        );
      }

      res.json({
        success: true,
        message: 'Role updated successfully',
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to update role',
      });
    }
  } catch (error) {
    console.error('Update Role Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update role',
      error: error.message,
    });
  }
};

/* Delete a role */
const deleteRole = async (req, res) => {
  try {
    const { roleId } = req.params;

    // Validate role exists and is not a system role
    const role = await rolePermissionDao.getRoleById(roleId);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    if (role.is_system_role) {
      return res.status(403).json({
        success: false,
        message: 'System roles cannot be deleted',
      });
    }

    const deleted = await rolePermissionDao.deleteRole(roleId);

    if (deleted) {
      // Log activity
      const user = req.user;
      if (user) {
        await activityLogDao.createLog(
          user.id,
          'ROLE_DELETE',
          `Deleted role: ${role.display_name}`,
          req.ip || req.connection.remoteAddress,
        );
      }

      res.json({
        success: true,
        message: 'Role deleted successfully',
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to delete role',
      });
    }
  } catch (error) {
    console.error('Delete Role Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete role',
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
  createRole,
  updateRole,
  deleteRole,

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
