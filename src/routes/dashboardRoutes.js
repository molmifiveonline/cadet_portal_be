const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// GET /api/dashboard/stats
router.get(
  '/stats',
  authMiddleware,
  requirePermission('dashboard', 'view'),
  dashboardController.getStats,
);

module.exports = router;
