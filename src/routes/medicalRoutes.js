const express = require('express');
const router = express.Router();
const medicalController = require('../controllers/medicalController');
const { authMiddleware } = require('../middleware/authMiddleware');
const {
  blockInstitute,
  requireInstituteCadetOwnership,
} = require('../middleware/instituteOwnershipMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.post(
  '/:cadet_id',
  authMiddleware,
  blockInstitute('Institute users are not allowed to save medical results'),
  upload.array('reports', 10),
  medicalController.saveMedicalResult,
);
router.get(
  '/:cadet_id',
  authMiddleware,
  requireInstituteCadetOwnership('cadet_id'),
  medicalController.getMedicalResult,
);
router.post(
  '/bulk/confirm',
  authMiddleware,
  blockInstitute('Institute users are not allowed to confirm candidates'),
  medicalController.bulkConfirmCandidates,
);
router.post(
  '/bulk/collect-academic',
  authMiddleware,
  blockInstitute('Institute users are not allowed to request academic data'),
  medicalController.bulkCollectAcademicData,
);
router.post(
  '/bulk/collect-documents',
  authMiddleware,
  blockInstitute('Institute users are not allowed to request candidate documents'),
  medicalController.bulkCollectDocuments,
);

module.exports = router;
