const express = require('express');
const router = express.Router();
const assessmentController = require('../controllers/assessmentController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/permissionMiddleware');
const upload = require('../middleware/uploadMiddleware');

// Apply protection to all assessment routes
router.use(authMiddleware);

// Allow SuperAdmin specifically or check for generic permissions
// Setting it to require SuperAdmin for now as per previous logic
router.use(requireSuperAdmin);

router
  .route('/:cadet_id')
  .get(assessmentController.getAssessment)
  .post(upload.single('essay'), assessmentController.saveAssessment)
  .delete(assessmentController.deleteAssessment);

router.get('/:cadet_id/essay/download', assessmentController.downloadEssay);

module.exports = router;
