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
  previewSubmitCadets,
  shortlistCadets,
  sendAssessmentInvites,
  sendInterviewInvites,
  sendMedicalInvites,
  finalizeShortlist,
  finalizeAssessment,
  finalizeInterview,
  finalizeMedical,
  closeDrive,
  getPendingDriveCount
} = require('../controllers/recruitmentDriveController');

const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { ROLES } = require('../config/constants');

// All routes are scoped to /api/recruitment-drives by index.js

// Apply auth middleware to all routes
router.use(authMiddleware);

const allowInstituteOrPermission = (module, action) => async (req, res, next) => {
  if (req.user?.role === ROLES.INSTITUTE) {
    return next();
  }

  return requirePermission(module, action)(req, res, next);
};

// Routes
router.post('/', requirePermission('recruitment_drives', 'create'), createRecruitmentDrive);
router.get('/', allowInstituteOrPermission('recruitment_drives', 'view'), getAllRecruitmentDrives);
router.get('/pending-count', getPendingDriveCount);
router.get('/:id', allowInstituteOrPermission('recruitment_drives', 'view'), getRecruitmentDriveById);
router.put('/:id', requirePermission('recruitment_drives', 'edit'), updateRecruitmentDrive);
router.delete('/:id', requirePermission('recruitment_drives', 'delete'), deleteRecruitmentDrive);
router.get('/:id/stats', allowInstituteOrPermission('recruitment_drives', 'view'), getRecruitmentDriveStats);
router.get('/:id/cadets', allowInstituteOrPermission('recruitment_drives', 'view'), getDriveCadetQueue);
router.get('/:id/communications', requirePermission('recruitment_drives', 'view'), getDriveCommunications);

// Workflow Action Routes
router.get('/:id/preview-submit-cadets', requirePermission('recruitment_drives', 'view'), previewSubmitCadets);
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
