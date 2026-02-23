const express = require('express');
const router = express.Router();
const userManagementController = require('../controllers/userManagementController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// Protect routes with auth middleware and dynamic permission checks
router.get(
  '/',
  authMiddleware,
  requirePermission('users', 'view'),
  userManagementController.getUsers,
);

router.get(
  '/:id',
  authMiddleware,
  requirePermission('users', 'view'),
  userManagementController.getUserById,
);

router.post(
  '/',
  authMiddleware,
  requirePermission('users', 'create'),
  userManagementController.createUser,
);

router.put(
  '/:id',
  authMiddleware,
  requirePermission('users', 'edit'),
  userManagementController.updateUser,
);

router.delete(
  '/:id',
  authMiddleware,
  requirePermission('users', 'delete'),
  userManagementController.deleteUser,
);

module.exports = router;
