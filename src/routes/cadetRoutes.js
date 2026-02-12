const express = require('express');
const router = express.Router();
const { getAllCadets } = require('../controllers/cadetController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// All routes are scoped to /api/cadets by index.js

router.get(
  '/',
  authMiddleware,
  requirePermission('cadets', 'view'),
  getAllCadets,
);

module.exports = router;
