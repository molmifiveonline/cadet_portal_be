const express = require('express');
const router = express.Router();
const interviewController = require('../controllers/interviewController');
const { authMiddleware } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.post('/:cadet_id', authMiddleware, upload.single('interview_sheet'), interviewController.saveInterview);
router.get('/:cadet_id', authMiddleware, interviewController.getInterview);
router.get('/:cadet_id/sheet', authMiddleware, interviewController.getInterviewSheet);

module.exports = router;
