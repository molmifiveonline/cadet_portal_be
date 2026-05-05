const express = require('express');
const router = express.Router();
const medicalCenterController = require('../controllers/medicalCenterController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// All medical center routes require authentication
router.use(authMiddleware);

// Define module name for permissions
const MODULE_NAME = 'medical-centers';

// Prefix: /api/medical-centers
router.post(
  '/',
  requirePermission(MODULE_NAME, 'create'),
  medicalCenterController.createMedicalCenter,
);
router.get(
  '/',
  requirePermission(MODULE_NAME, 'view'),
  medicalCenterController.getAllMedicalCenters,
);
router.get(
  '/:id',
  requirePermission(MODULE_NAME, 'view'),
  medicalCenterController.getMedicalCenterById,
);
router.put(
  '/:id',
  requirePermission(MODULE_NAME, 'edit'),
  medicalCenterController.updateMedicalCenter,
);
router.delete(
  '/:id',
  requirePermission(MODULE_NAME, 'delete'),
  medicalCenterController.deleteMedicalCenter,
);

module.exports = router;
