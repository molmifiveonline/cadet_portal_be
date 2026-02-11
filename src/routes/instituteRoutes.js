const express = require('express');
const router = express.Router();
const {
  createInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  deleteInstitute,
} = require('../controllers/instituteController');

// All routes are scoped to /api/institutes by index.js

router.post('/', createInstitute);
router.get('/', getAllInstitutes);
router.get('/:id', getInstituteById);
router.put('/:id', updateInstitute);
router.delete('/:id', deleteInstitute);

module.exports = router;
