const express = require('express');
const router = express.Router();
const {
  getCVFormByToken,
  submitCVForm,
  sendCVFormEmail,
  resendCVFormEmail,
  getCVTokenStatus,
} = require('../controllers/cvFormController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// Public routes (no authentication required, token-based access)
router.get('/public/:token', getCVFormByToken);
router.post('/public/:token', submitCVForm);

// Protected admin routes
router.post(
  '/send-email',
  authMiddleware,
  requirePermission('cadets', 'manage'),
  sendCVFormEmail,
);

router.post(
  '/resend/:cadetId',
  authMiddleware,
  requirePermission('cadets', 'manage'),
  resendCVFormEmail,
);

router.get(
  '/token-status/:cadetId',
  authMiddleware,
  requirePermission('cadets', 'view'),
  getCVTokenStatus,
);

module.exports = router;
