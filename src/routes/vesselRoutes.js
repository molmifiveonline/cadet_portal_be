const express = require('express');
const router = express.Router();
const vesselController = require('../controllers/vesselController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// All vessel routes require authentication
router.use(authMiddleware);

// Get all vessels (read)
router.get(
  '/',
  requirePermission('vessel-master', 'view'),
  vesselController.getAllVessels,
);

// Get single vessel (read)
router.get(
  '/:id',
  requirePermission('vessel-master', 'view'),
  vesselController.getVesselById,
);

// Create new vessel (create)
router.post(
  '/',
  requirePermission('vessel-master', 'create'),
  vesselController.createVessel,
);

// Update existing vessel (edit)
router.put(
  '/:id',
  requirePermission('vessel-master', 'edit'),
  vesselController.updateVessel,
);

// Delete vessel (delete)
router.delete(
  '/:id',
  requirePermission('vessel-master', 'delete'),
  vesselController.deleteVessel,
);

module.exports = router;
