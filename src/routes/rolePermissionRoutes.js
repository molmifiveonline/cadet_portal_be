const express = require('express');
const router = express.Router();
const rolePermissionController = require('../controllers/rolePermissionController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

/* ROLE & PERMISSIONS ROUTES
 * All routes require authentication
 * Most routes require Super Admin access
 */

/* ==================== ROLES ====================

/* @route   GET /api/role-permissions/roles
 * @desc    Get all roles
 * @access  Super Admin only
 */
router.get(
  '/roles',
  authMiddleware,
  requirePermission('role-permissions', 'manage'),
  rolePermissionController.getAllRoles,
);

/* @route   GET /api/role-permissions/roles/:roleId
 * @desc    Get role by ID
 * @access  Super Admin only
 */
router.get(
  '/roles/:roleId',
  authMiddleware,
  requirePermission('role-permissions', 'manage'),
  rolePermissionController.getRoleById,
);

/* ==================== PERMISSIONS ====================

/* @route   GET /api/role-permissions/permissions
 * @desc    Get all permissions
 * @access  Super Admin only
 */
router.get(
  '/permissions',
  authMiddleware,
  requirePermission('role-permissions', 'manage'),
  rolePermissionController.getAllPermissions,
);

/* @route   GET /api/role-permissions/permissions/by-module
 * @desc    Get permissions grouped by module
 * @access  Super Admin only
 */
router.get(
  '/permissions/by-module',
  authMiddleware,
  requirePermission('role-permissions', 'manage'),
  rolePermissionController.getPermissionsByModule,
);

/* ==================== ROLE PERMISSIONS ====================

/* @route   GET /api/role-permissions/roles/:roleId/permissions
 * @desc    Get permissions for a specific role
 * @access  Super Admin only
 */
router.get(
  '/roles/:roleId/permissions',
  authMiddleware,
  requirePermission('role-permissions', 'manage'),
  rolePermissionController.getRolePermissions,
);

/* @route   PUT /api/role-permissions/roles/:roleId/permissions
 * @desc    Update permissions for a role (bulk update)
 * @access  Super Admin only
 */
router.put(
  '/roles/:roleId/permissions',
  authMiddleware,
  requirePermission('role-permissions', 'manage'),
  rolePermissionController.updateRolePermissions,
);

/* @route   POST /api/role-permissions/roles/:roleId/permissions/set
 * @desc    Set a single permission for a role
 * @access  Super Admin only
 */
router.post(
  '/roles/:roleId/permissions/set',
  authMiddleware,
  requirePermission('role-permissions', 'manage'),
  rolePermissionController.setRolePermission,
);

/* ==================== USER PERMISSIONS ====================

/* @route   GET /api/role-permissions/me/permissions
 * @desc    Get current user's permissions
 * @access  Authenticated users
 */
router.get(
  '/me/permissions',
  authMiddleware,
  rolePermissionController.getCurrentUserPermissions,
);

/* @route   GET /api/role-permissions/me/check
 * @desc    Check if current user has specific permission
 * @access  Authenticated users
 * @query   module, action
 */
router.get(
  '/me/check',
  authMiddleware,
  rolePermissionController.checkUserPermission,
);

module.exports = router;
