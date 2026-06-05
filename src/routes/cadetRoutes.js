const express = require('express');
const router = express.Router();
const {
  getAllCadets,
  getCadetById,
  importCadets,
  createCadet,
  getShortlistedCadets,
  getInstituteShortlistedCadets,
  getShortlistStats,
  updateCadet,
  getCadetPhoto,
  deleteCadet,
} = require('../controllers/cadetController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const {
  blockInstitute,
  isInstituteUser,
  requireInstituteCadetOwnership,
  requireInstitutePendingDetailEditAccess,
} = require('../middleware/instituteOwnershipMiddleware');
const upload = require('../middleware/uploadMiddleware');

const allowInstituteOrPermission = (module, action) => async (req, res, next) => {
  if (isInstituteUser(req.user)) {
    return next();
  }

  return requirePermission(module, action)(req, res, next);
};

// All routes are scoped to /api/cadets by index.js

router.get(
  '/',
  authMiddleware,
  requirePermission('cadets', 'view'),
  getAllCadets,
);

// Create cadet
router.post(
  '/',
  authMiddleware,
  requirePermission('cadets', 'create'),
  upload.single('photo'),
  createCadet,
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

// Institute-specific shortlist route (auto-scoped by JWT, no permission check needed)
router.get(
  '/institute-shortlisted',
  authMiddleware,
  getInstituteShortlistedCadets,
);

router.get(
  '/shortlisted/stats',
  authMiddleware,
  requirePermission('cadets', 'view'),
  getShortlistStats,
);

// Serve cadet photo from DB (no auth needed for <img> tags)
router.get('/:id/photo', getCadetPhoto);

router.get(
  '/:id',
  authMiddleware,
  allowInstituteOrPermission('cadets', 'view'),
  requireInstituteCadetOwnership('id'),
  getCadetById,
);

// Update cadet
router.put(
  '/:id',
  authMiddleware,
  allowInstituteOrPermission('cadets', 'edit'),
  requireInstituteCadetOwnership('id'),
  requireInstitutePendingDetailEditAccess('id'),
  upload.single('photo'),
  updateCadet,
);

// Delete cadet
router.delete(
  '/:id',
  authMiddleware,
  blockInstitute('Institute users are not allowed to delete cadets'),
  requirePermission('cadets', 'delete'),
  deleteCadet,
);

module.exports = router;
