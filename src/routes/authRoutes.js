const express = require('express');
const router = express.Router();
const {
  login,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');
const {
  requestInstituteOtp,
  verifyInstituteOtp,
} = require('../controllers/instituteOtpController');

// router.post('/register/candidate', registerCandidate); // Removed as per user request to limit scope
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Institute OTP Login
router.post('/institute/request-otp', requestInstituteOtp);
router.post('/institute/verify-otp', verifyInstituteOtp);

module.exports = router;
