const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const dashboardAccess = (req, res, next) =>
  ['Institute', 'Cadet'].includes(req.user?.role)
    ? next()
    : requirePermission('dashboard', 'view')(req, res, next);

// GET /api/dashboard/stats
router.get(
  '/stats',
  authMiddleware,
  dashboardAccess,
  dashboardController.getStats,
);

router.get(
  '/candidates',
  authMiddleware,
  dashboardAccess,
  dashboardController.getCandidates,
);

router.put(
  '/documents/:id',
  authMiddleware,
  (req, res, next) => {
    if (req.user?.role !== 'Cadet')
      return res
        .status(403)
        .json({ message: 'Personal uploads require a cadet account' });
    next();
  },
  require('../middleware/uploadMiddleware').memory.single('document'),
  dashboardController.uploadDocument,
);

module.exports = router;
