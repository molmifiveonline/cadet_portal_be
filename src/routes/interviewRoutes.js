const express = require('express');
const router = express.Router();
const interviewController = require('../controllers/interviewController');
const { authMiddleware } = require('../middleware/authMiddleware');

router.post('/:cadet_id', authMiddleware, interviewController.saveInterview);
router.get('/:cadet_id', authMiddleware, interviewController.getInterview);

module.exports = router;
