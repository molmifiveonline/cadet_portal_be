const express = require('express');
const router = express.Router();
const {
  createInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  deleteInstitute,
  extendInstituteToken,
} = require('../controllers/instituteController');

const {
  submitInstituteExcel,
  getAllSubmissions,
  importSubmission,
  downloadSubmission,
  deleteSubmission,
  bulkDeleteSubmissions,
  bulkImportSubmissions,
} = require('../controllers/instituteSubmissionController');

const {
  sendInstituteEmail,
  sendShortlistEmail,
  verifyInstituteToken,
  loginInstitute,
} = require('../controllers/instituteAuthController');

const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middleware/permissionMiddleware');
const upload = require('../middleware/uploadMiddleware');

// All routes are scoped to /api/institutes by index.js

// Public routes (protected by token in URL/Body)
router.get('/verify-token', verifyInstituteToken);
router.post('/login', loginInstitute);

router.post(
  '/submit-excel',
  authMiddleware,
  upload.memory.single('file'),
  submitInstituteExcel,
);

// Submissions Management (Admin)
router.get(
  '/submissions',
  authMiddleware,
  requirePermission('institutes', 'view'),
  getAllSubmissions,
);

router.post(
  '/submissions/bulk-import',
  authMiddleware,
  requirePermission('institutes', 'edit'),
  bulkImportSubmissions,
);

router.delete(
  '/submissions/bulk',
  authMiddleware,
  requirePermission('institutes', 'delete'),
  bulkDeleteSubmissions,
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

router.delete(
  '/submissions/:id',
  authMiddleware,
  requirePermission('institutes', 'delete'),
  deleteSubmission,
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
  requireAnyPermission([
    ['institutes', 'create'],
    ['recruitment_drives', 'edit'],
  ]),
  upload.single('file'),
  sendInstituteEmail,
);

router.post(
  '/send-shortlist-email',
  authMiddleware,
  requireAnyPermission([
    ['institutes', 'create'],
    ['recruitment_drives', 'edit'],
  ]),
  sendShortlistEmail,
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
  '/:id/extend-token',
  authMiddleware,
  requirePermission('institutes', 'edit'),
  extendInstituteToken,
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
