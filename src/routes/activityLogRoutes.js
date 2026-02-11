const express = require('express');
const router = express.Router();
const activityLogController = require('../controllers/activityLogController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// Protect these routes - use dynamic permission check
// Only users with 'view' action on 'activity-logs' module can access
router.get(
  '/recent',
  authMiddleware,
  requirePermission('activity-logs', 'view'),
  activityLogController.getRecentLogs,
);

module.exports = router;
