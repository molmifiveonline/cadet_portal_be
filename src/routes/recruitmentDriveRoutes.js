const express = require('express');
const router = express.Router();
const {
  createRecruitmentDrive,
  getAllRecruitmentDrives,
  getRecruitmentDriveById,
  updateRecruitmentDrive,
  deleteRecruitmentDrive,
  getRecruitmentDriveStats,
  getDriveCadetQueue,
  getDriveCommunications,
  submitCadetDetails,
  shortlistCadets,
  sendAssessmentInvites,
  sendInterviewInvites,
  sendMedicalInvites,
  finalizeShortlist,
  finalizeAssessment,
  finalizeInterview,
  finalizeMedical,
  closeDrive
} = require('../controllers/recruitmentDriveController');

const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// All routes are scoped to /api/recruitment-drives by index.js

// Apply auth middleware to all routes
router.use(authMiddleware);

// Routes
router.post('/', requirePermission('recruitment_drives', 'create'), createRecruitmentDrive);
router.get('/', requirePermission('recruitment_drives', 'view'), getAllRecruitmentDrives);
router.get('/:id', requirePermission('recruitment_drives', 'view'), getRecruitmentDriveById);
router.put('/:id', requirePermission('recruitment_drives', 'edit'), updateRecruitmentDrive);
router.delete('/:id', requirePermission('recruitment_drives', 'delete'), deleteRecruitmentDrive);
router.get('/:id/stats', requirePermission('recruitment_drives', 'view'), getRecruitmentDriveStats);
router.get('/:id/cadets', requirePermission('recruitment_drives', 'view'), getDriveCadetQueue);
router.get('/:id/communications', requirePermission('recruitment_drives', 'view'), getDriveCommunications);

// Workflow Action Routes
router.post('/:id/submit-cadets', requirePermission('recruitment_drives', 'edit'), submitCadetDetails);
router.post('/:id/shortlist', requirePermission('recruitment_drives', 'edit'), shortlistCadets);
router.post('/:id/send-assessment-invites', requirePermission('recruitment_drives', 'edit'), sendAssessmentInvites);
router.post('/:id/send-interview-invites', requirePermission('recruitment_drives', 'edit'), sendInterviewInvites);
router.post('/:id/send-medical-invites', requirePermission('recruitment_drives', 'edit'), sendMedicalInvites);
router.post('/:id/finalize-shortlist', requirePermission('recruitment_drives', 'edit'), finalizeShortlist);
router.post('/:id/finalize-assessment', requirePermission('recruitment_drives', 'edit'), finalizeAssessment);
router.post('/:id/finalize-interview', requirePermission('recruitment_drives', 'edit'), finalizeInterview);
router.post('/:id/finalize-medical', requirePermission('recruitment_drives', 'edit'), finalizeMedical);
router.post('/:id/close', requirePermission('recruitment_drives', 'edit'), closeDrive);

module.exports = router;
