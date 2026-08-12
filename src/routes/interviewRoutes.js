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
  upload.interviewSheet.single('interview_sheet'),
  interviewController.saveInterview,
);
router.post(
  '/:cadet_id/handwritten-sheet',
  authMiddleware,
  requireSuperAdmin,
  upload.handwrittenPdf.single('handwritten_sheet'),
  interviewController.saveHandwrittenSheet,
);
router.get(
  '/:cadet_id/handwritten-sheets',
  authMiddleware,
  requireSuperAdminOrInstituteCadetRead('cadet_id'),
  interviewController.getHandwrittenDocuments,
);
router.get(
  '/:cadet_id/handwritten-sheets/:document_id',
  authMiddleware,
  requireSuperAdminOrInstituteCadetRead('cadet_id'),
  interviewController.getHandwrittenDocument,
);
router.delete(
  '/:cadet_id/handwritten-sheets/:document_id',
  authMiddleware,
  requireSuperAdmin,
  interviewController.deleteHandwrittenDocument,
);
router.post(
  '/:cadet_id/attachments',
  authMiddleware,
  requireSuperAdmin,
  upload.interviewSheet.array('interview_sheets', 10),
  interviewController.uploadInterviewAttachments,
);
router.get(
  '/:cadet_id/attachments',
  authMiddleware,
  requireSuperAdminOrInstituteCadetRead('cadet_id'),
  interviewController.getInterviewAttachments,
);
router.get(
  '/:cadet_id/attachments/:attachment_id',
  authMiddleware,
  requireSuperAdminOrInstituteCadetRead('cadet_id'),
  interviewController.getInterviewAttachment,
);
router.delete(
  '/:cadet_id/attachments/:attachment_id',
  authMiddleware,
  requireSuperAdmin,
  interviewController.deleteInterviewAttachment,
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
router.get(
  '/:cadet_id/handwritten-sheet',
  authMiddleware,
  requireSuperAdminOrInstituteCadetRead('cadet_id'),
  interviewController.getHandwrittenSheet,
);

module.exports = router;
