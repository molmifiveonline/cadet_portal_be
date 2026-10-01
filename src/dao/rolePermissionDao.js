const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const {
  ensureRolePermissionCatalog,
} = require('../services/rolePermissionCatalog');

// Retain historical grants, but do not expose or honor removed actions.
const isAvailablePermission = ({ module, action }) =>
  !(module === 'recruitment_drives' && action === 'delete');

/* Get all roles */
const getAllRoles = async () => {
  const [rows] = await db.query(
    `SELECT r.id, r.name, r.display_name, r.description, r.is_system_role, r.created_at,
      (SELECT COUNT(*) FROM users u WHERE LOWER(u.role) = LOWER(r.name) COLLATE utf8mb4_unicode_ci) AS assigned_user_count
    FROM roles r ORDER BY r.name`,
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

/* Create a new role */
const createRole = async (roleData) => {
  const { name, display_name, description } = roleData;
  const id = uuidv4();

  const [result] = await db.query(
    'INSERT INTO roles (id, name, display_name, description, is_system_role) VALUES (?, ?, ?, ?, ?)',
    [id, name, display_name, description, false],
  );

  return result.affectedRows > 0
    ? { id, name, display_name, description }
    : null;
};

/* Update an existing role */
const updateRole = async (roleId, roleData) => {
  const { display_name, description } = roleData;

  const [result] = await db.query(
    'UPDATE roles SET display_name = ?, description = ?, updated_at = NOW() WHERE id = ? AND is_system_role = FALSE',
    [display_name, description, roleId],
  );

  return result.affectedRows > 0;
};

/* Delete a role */
const deleteRole = async (roleId) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [roles] = await connection.query(
      'SELECT name, is_system_role FROM roles WHERE id = ? FOR UPDATE',
      [roleId],
    );
    if (!roles.length || roles[0].is_system_role) {
      await connection.rollback();
      return false;
    }
    const [users] = await connection.query(
      'SELECT id FROM users WHERE LOWER(role) = LOWER(?) LIMIT 1 FOR UPDATE',
      [roles[0].name],
    );
    if (users.length)
      throw Object.assign(
        new Error('Assign users to another role before deleting this role'),
        { status: 409 },
      );
    await connection.query('DELETE FROM role_permissions WHERE role_id = ?', [
      roleId,
    ]);
    const [result] = await connection.query(
      'DELETE FROM roles WHERE id = ? AND is_system_role = FALSE',
      [roleId],
    );
    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/* Get all permissions */
const getAllPermissions = async () => {
  await ensureRolePermissionCatalog();
  const [rows] = await db.query(
    'SELECT id, module, action, display_name, description FROM permissions ORDER BY module, action',
  );
  return rows.filter(isAvailablePermission);
};

/* Get permissions grouped by module */
const getPermissionsByModule = async () => {
  const rows = await getAllPermissions();

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
  await ensureRolePermissionCatalog();
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
  return rows.filter(isAvailablePermission);
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
  if (!isAvailablePermission({ module, action })) return false;
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
  if (!isAvailablePermission({ module, action })) return false;
  await ensureRolePermissionCatalog();
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
const writeRolePermission = async (
  connection,
  roleId,
  permissionId,
  granted,
) => {
  const id = uuidv4();

  // Check if record exists
  const [existing] = await connection.query(
    'SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ?',
    [roleId, permissionId],
  );

  if (existing.length > 0) {
    // Update existing
    const [result] = await connection.query(
      'UPDATE role_permissions SET granted = ?, updated_at = NOW() WHERE role_id = ? AND permission_id = ?',
      [granted, roleId, permissionId],
    );
    return result.affectedRows > 0;
  } else {
    // Insert new
    const [result] = await connection.query(
      'INSERT INTO role_permissions (id, role_id, permission_id, granted) VALUES (?, ?, ?, ?)',
      [id, roleId, permissionId, granted],
    );
    return result.affectedRows > 0;
  }
};

/* Update multiple permissions for a role at once */
const updateRolePermissions = async (roleId, permissions) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    // Serialize saves for this role, including the first grant of an action.
    const [roles] = await connection.query(
      'SELECT id FROM roles WHERE id = ? FOR UPDATE',
      [roleId],
    );
    if (!roles.length)
      throw Object.assign(new Error('Role not found'), { status: 404 });
    for (const { permissionId, granted } of permissions) {
      await writeRolePermission(connection, roleId, permissionId, granted);
    }
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const setRolePermission = (roleId, permissionId, granted) =>
  updateRolePermissions(roleId, [{ permissionId, granted }]);

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
  await ensureRolePermissionCatalog();
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
  return rows.filter(isAvailablePermission);
};

module.exports = {
  // Roles
  getAllRoles,
  getRoleById,
  getRoleByName,
  createRole,
  updateRole,
  deleteRole,

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
