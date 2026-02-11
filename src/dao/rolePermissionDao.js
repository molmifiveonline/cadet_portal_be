const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/* Get all roles */
const getAllRoles = async () => {
  const [rows] = await db.query(
    'SELECT id, name, display_name, description, is_system_role, created_at FROM roles ORDER BY name',
  );
  return rows;
};

/* Get role by ID */
const getRoleById = async (roleId) => {
  const [rows] = await db.query(
    'SELECT id, name, display_name, description, is_system_role FROM roles WHERE id = ?',
    [roleId],
  );
  return rows[0];
};

/* Get role by name */
const getRoleByName = async (roleName) => {
  const [rows] = await db.query(
    'SELECT id, name, display_name, description, is_system_role FROM roles WHERE name = ?',
    [roleName],
  );
  return rows[0];
};

/* Get all permissions */
const getAllPermissions = async () => {
  const [rows] = await db.query(
    'SELECT id, module, action, display_name, description FROM permissions ORDER BY module, action',
  );
  return rows;
};

/* Get permissions grouped by module */
const getPermissionsByModule = async () => {
  const [rows] = await db.query(
    'SELECT id, module, action, display_name, description FROM permissions ORDER BY module, action',
  );

  // Group by module
  const grouped = {};
  rows.forEach((permission) => {
    if (!grouped[permission.module]) {
      grouped[permission.module] = [];
    }
    grouped[permission.module].push(permission);
  });

  return grouped;
};

/* Get all permissions for a specific role */
const getRolePermissions = async (roleId) => {
  const [rows] = await db.query(
    `SELECT 
      p.id,
      p.module,
      p.action,
      p.display_name,
      p.description,
      rp.granted
    FROM permissions p
    LEFT JOIN role_permissions rp ON p.id = rp.permission_id AND rp.role_id = ?
    ORDER BY p.module, p.action`,
    [roleId],
  );
  return rows;
};

/* Get permissions for a role grouped by module */
const getRolePermissionsByModule = async (roleId) => {
  const permissions = await getRolePermissions(roleId);

  // Group by module
  const grouped = {};
  permissions.forEach((permission) => {
    if (!grouped[permission.module]) {
      grouped[permission.module] = {
        module: permission.module,
        permissions: [],
      };
    }
    grouped[permission.module].permissions.push({
      id: permission.id,
      action: permission.action,
      display_name: permission.display_name,
      description: permission.description,
      granted: permission.granted === 1 || permission.granted === true,
    });
  });

  return Object.values(grouped);
};

/* Check if a role has a specific permission */
const hasPermission = async (roleId, module, action) => {
  const [rows] = await db.query(
    `SELECT rp.granted
    FROM role_permissions rp
    JOIN permissions p ON rp.permission_id = p.id
    WHERE rp.role_id = ? AND p.module = ? AND p.action = ? AND rp.granted = TRUE`,
    [roleId, module, action],
  );
  return rows.length > 0;
};

/* Check if user (by role name) has permission */
const userHasPermission = async (roleName, module, action) => {
  const [rows] = await db.query(
    `SELECT rp.granted
    FROM role_permissions rp
    JOIN permissions p ON rp.permission_id = p.id
    JOIN roles r ON rp.role_id = r.id
    WHERE LOWER(r.name) = LOWER(?) COLLATE utf8mb4_unicode_ci AND p.module = ? AND p.action = ? AND (rp.granted = 1 OR rp.granted = TRUE)`,
    [roleName, module, action],
  );
  return rows.length > 0;
};

/* Grant or revoke a permission for a role */
const setRolePermission = async (roleId, permissionId, granted) => {
  const id = uuidv4();

  // Check if record exists
  const [existing] = await db.query(
    'SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ?',
    [roleId, permissionId],
  );

  if (existing.length > 0) {
    // Update existing
    const [result] = await db.query(
      'UPDATE role_permissions SET granted = ?, updated_at = NOW() WHERE role_id = ? AND permission_id = ?',
      [granted, roleId, permissionId],
    );
    return result.affectedRows > 0;
  } else {
    // Insert new
    const [result] = await db.query(
      'INSERT INTO role_permissions (id, role_id, permission_id, granted) VALUES (?, ?, ?, ?)',
      [id, roleId, permissionId, granted],
    );
    return result.affectedRows > 0;
  }
};

/* Update multiple permissions for a role at once */
const updateRolePermissions = async (roleId, permissions) => {
  // permissions is an array of { permissionId, granted }
  const promises = permissions.map(({ permissionId, granted }) =>
    setRolePermission(roleId, permissionId, granted),
  );

  await Promise.all(promises);
  return true;
};

/* Remove all permissions for a role */
const clearRolePermissions = async (roleId) => {
  const [result] = await db.query(
    'DELETE FROM role_permissions WHERE role_id = ?',
    [roleId],
  );
  return result.affectedRows;
};

/* Get permissions by role name */
const getPermissionsByRoleName = async (roleName) => {
  const [rows] = await db.query(
    `SELECT 
      p.id,
      p.module,
      p.action,
      p.display_name
    FROM roles r
    JOIN role_permissions rp ON r.id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE LOWER(r.name) = LOWER(?) COLLATE utf8mb4_unicode_ci AND (rp.granted = 1 OR rp.granted = TRUE)`,
    [roleName],
  );
  return rows;
};

module.exports = {
  // Roles
  getAllRoles,
  getRoleById,
  getRoleByName,

  // Permissions
  getAllPermissions,
  getPermissionsByModule,

  // Role Permissions
  getRolePermissions,
  getRolePermissionsByModule,
  hasPermission,
  userHasPermission,
  setRolePermission,
  updateRolePermissions,
  clearRolePermissions,
  getPermissionsByRoleName,
};
