const express = require('express');
const router = express.Router();
const {
  createRecruitmentDrive,
  getAllRecruitmentDrives,
  getRecruitmentDriveById,
  updateRecruitmentDrive,
  deleteRecruitmentDrive,
  getRecruitmentDriveStats
} = require('../controllers/recruitmentDriveController');

const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// All routes are scoped to /api/recruitment-drives by index.js

// Apply auth middleware to all routes
router.use(authMiddleware);

// Routes
router.post('/', requirePermission('recruitment_drives', 'create'), createRecruitmentDrive);
router.get('/', requirePermission('recruitment_drives', 'view'), getAllRecruitmentDrives);
router.get('/:id', requirePermission('recruitment_drives', 'view'), getRecruitmentDriveById);
router.put('/:id', requirePermission('recruitment_drives', 'edit'), updateRecruitmentDrive);
router.delete('/:id', requirePermission('recruitment_drives', 'delete'), deleteRecruitmentDrive);
router.get('/:id/stats', requirePermission('recruitment_drives', 'view'), getRecruitmentDriveStats);

module.exports = router;