const express = require('express');
const router = express.Router();
const {
  createInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  deleteInstitute,
} = require('../controllers/instituteController');

const {
  sendInstituteEmail,
  verifyInstituteToken,
  submitInstituteExcel,
  getAllSubmissions,
  importSubmission,
  downloadSubmission,
} = require('../controllers/instituteSubmissionController');

const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const upload = require('../middleware/uploadMiddleware');

// All routes are scoped to /api/institutes by index.js

// Public routes (protected by token in URL/Body)
router.get('/verify-token', verifyInstituteToken);
router.post('/submit-excel', upload.single('file'), submitInstituteExcel);

// Submissions Management (Admin)
router.get(
  '/submissions',
  authMiddleware,
  requirePermission('institutes', 'view'),
  getAllSubmissions,
);

router.get(
  '/submissions/:id/download',
  authMiddleware,
  requirePermission('institutes', 'view'),
  downloadSubmission,
);

router.post(
  '/submissions/:id/import',
  authMiddleware,
  requirePermission('institutes', 'edit'),
  importSubmission,
);

router.post(
  '/',
  authMiddleware,
  requirePermission('institutes', 'create'),
  createInstitute,
);

router.post(
  '/send-email',
  authMiddleware,
  requirePermission('institutes', 'create'),
  upload.single('file'),
  sendInstituteEmail,
);
router.get(
  '/',
  authMiddleware,
  requirePermission('institutes', 'view'),
  getAllInstitutes,
);
router.get(
  '/:id',
  authMiddleware,
  requirePermission('institutes', 'view'),
  getInstituteById,
);
router.put(
  '/:id',
  authMiddleware,
  requirePermission('institutes', 'edit'),
  updateInstitute,
);
router.delete(
  '/:id',
  authMiddleware,
  requirePermission('institutes', 'delete'),
  deleteInstitute,
);

module.exports = router;
