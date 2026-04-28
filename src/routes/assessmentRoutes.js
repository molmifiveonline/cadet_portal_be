const express = require('express');
const router = express.Router();
const assessmentController = require('../controllers/assessmentController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/permissionMiddleware');
const {
  requireSuperAdminOrInstituteCadetRead,
} = require('../middleware/instituteOwnershipMiddleware');
const upload = require('../middleware/uploadMiddleware');

// Apply protection to all assessment routes
router.use(authMiddleware);

router
  .route('/:cadet_id')
  .get(requireSuperAdminOrInstituteCadetRead('cadet_id'), assessmentController.getAssessment)
  .post(requireSuperAdmin, upload.single('essay'), assessmentController.saveAssessment)
  .delete(requireSuperAdmin, assessmentController.deleteAssessment);

router.get(
  '/:cadet_id/essay/download',
  requireSuperAdminOrInstituteCadetRead('cadet_id'),
  assessmentController.downloadEssay,
);

module.exports = router;
