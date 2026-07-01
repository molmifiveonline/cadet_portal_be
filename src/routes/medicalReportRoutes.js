const express = require('express');
const router = express.Router();
const medicalReportController = require('../controllers/medicalReportController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// All medical report routes require authentication
router.use(authMiddleware);

// Define module name for permissions (shares with medical centers)
const MODULE_NAME = 'medical-centers';

// Prefix: /api/medical-reports
router.post(
  '/',
  requirePermission(MODULE_NAME, 'create'),
  medicalReportController.createMedicalReport,
);
router.get(
  '/',
  requirePermission(MODULE_NAME, 'view'),
  medicalReportController.getAllMedicalReports,
);
router.get(
  '/:id',
  requirePermission(MODULE_NAME, 'view'),
  medicalReportController.getMedicalReportById,
);
router.put(
  '/:id',
  requirePermission(MODULE_NAME, 'edit'),
  medicalReportController.updateMedicalReport,
);
router.delete(
  '/:id',
  requirePermission(MODULE_NAME, 'delete'),
  medicalReportController.deleteMedicalReport,
);

module.exports = router;
