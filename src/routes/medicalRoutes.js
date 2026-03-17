const express = require('express');
const router = express.Router();
const medicalController = require('../controllers/medicalController');
const { authMiddleware } = require('../middleware/authMiddleware');

router.post('/:cadet_id', authMiddleware, medicalController.saveMedicalResult);
router.get('/:cadet_id', authMiddleware, medicalController.getMedicalResult);
router.post('/bulk/confirm', authMiddleware, medicalController.bulkConfirmCandidates);
router.post('/bulk/collect-academic', authMiddleware, medicalController.bulkCollectAcademicData);
router.post('/bulk/collect-documents', authMiddleware, medicalController.bulkCollectDocuments);

module.exports = router;
