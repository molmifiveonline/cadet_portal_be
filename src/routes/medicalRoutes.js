const express = require('express');
const router = express.Router();
const medicalController = require('../controllers/medicalController');
const { authMiddleware } = require('../middleware/authMiddleware');

router.post('/:cadet_id', authMiddleware, medicalController.saveMedicalResult);
router.get('/:cadet_id', authMiddleware, medicalController.getMedicalResult);

module.exports = router;
