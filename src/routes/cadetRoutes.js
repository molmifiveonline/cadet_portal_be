const express = require('express');
const router = express.Router();
const {
  getAllCadets,
  getCadetById,
  importCadets,
  getShortlistedCadets,
  exportShortlistedCadets,
  getShortlistStats,
  updateCadet,
  deleteCadet,
} = require('../controllers/cadetController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const upload = require('../middleware/uploadMiddleware');

// All routes are scoped to /api/cadets by index.js

router.get(
  '/',
  authMiddleware,
  requirePermission('cadets', 'view'),
  getAllCadets,
);

router.post(
  '/import',
  authMiddleware,
  requirePermission('cadets', 'create'),
  upload.single('excelFile'),
  importCadets,
);

// Shortlist routes
router.get(
  '/shortlisted',
  authMiddleware,
  requirePermission('cadets', 'view'),
  getShortlistedCadets,
);

router.get(
  '/shortlisted/stats',
  authMiddleware,
  requirePermission('cadets', 'view'),
  getShortlistStats,
);

router.get(
  '/shortlisted/export/:instituteId',
  authMiddleware,
  requirePermission('cadets', 'view'),
  exportShortlistedCadets,
);

router.get(
  '/:id',
  authMiddleware,
  requirePermission('cadets', 'view'),
  getCadetById,
);

// Update cadet
router.put(
  '/:id',
  authMiddleware,
  requirePermission('cadets', 'edit'),
  upload.single('photo'),
  updateCadet,
);

// Delete cadet
router.delete(
  '/:id',
  authMiddleware,
  requirePermission('cadets', 'delete'),
  deleteCadet,
);

module.exports = router;
