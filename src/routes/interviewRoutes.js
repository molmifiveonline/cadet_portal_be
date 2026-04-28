const express = require('express');
const router = express.Router();
const interviewController = require('../controllers/interviewController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/permissionMiddleware');
const {
  requireSuperAdminOrInstituteCadetRead,
} = require('../middleware/instituteOwnershipMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.post(
  '/:cadet_id',
  authMiddleware,
  requireSuperAdmin,
  upload.single('interview_sheet'),
  interviewController.saveInterview,
);
router.get(
  '/:cadet_id',
  authMiddleware,
  requireSuperAdminOrInstituteCadetRead('cadet_id'),
  interviewController.getInterview,
);
router.get(
  '/:cadet_id/sheet',
  authMiddleware,
  requireSuperAdminOrInstituteCadetRead('cadet_id'),
  interviewController.getInterviewSheet,
);

module.exports = router;
