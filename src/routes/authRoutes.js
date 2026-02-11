const express = require('express');
const router = express.Router();
const {
  login,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');

// router.post('/register/candidate', registerCandidate); // Removed as per user request to limit scope
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
