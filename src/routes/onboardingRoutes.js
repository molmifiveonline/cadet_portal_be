const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const controller = require('../controllers/onboardingController');

const router = express.Router();
router.use(authMiddleware);
router.get('/', requirePermission('onboarding', 'view'), controller.listOnboarding);
router.put('/:id/checklist', requirePermission('onboarding', 'edit'), controller.updateChecklist);

module.exports = router;
