const express = require('express');
const router = express.Router();
const {
  createInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  deleteInstitute,
} = require('../controllers/instituteController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// All routes are scoped to /api/institutes by index.js

router.post(
  '/',
  authMiddleware,
  requirePermission('institutes', 'create'),
  createInstitute,
);
router.get(
  '/',
  authMiddleware,
  requirePermission('institutes', 'view'),
  getAllInstitutes,
);
router.get(
  '/:id',
  authMiddleware,
  requirePermission('institutes', 'view'),
  getInstituteById,
);
router.put(
  '/:id',
  authMiddleware,
  requirePermission('institutes', 'edit'),
  updateInstitute,
);
router.delete(
  '/:id',
  authMiddleware,
  requirePermission('institutes', 'delete'),
  deleteInstitute,
);

module.exports = router;
