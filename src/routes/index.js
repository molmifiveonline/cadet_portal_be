const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./authRoutes');
const instituteRoutes = require('./instituteRoutes');
const activityLogRoutes = require('./activityLogRoutes');
const userManagementRoutes = require('./userManagementRoutes');
const rolePermissionRoutes = require('./rolePermissionRoutes');
const cadetRoutes = require('./cadetRoutes');
const vesselRoutes = require('./vesselRoutes');
const medicalCenterRoutes = require('./medicalCenterRoutes');
const assessmentRoutes = require('./assessmentRoutes');

// Use routes
router.use('/auth', authRoutes);
router.use('/institutes', instituteRoutes);
router.use('/activity-logs', activityLogRoutes);
router.use('/users', userManagementRoutes);
router.use('/role-permissions', rolePermissionRoutes);
router.use('/cadets', cadetRoutes);
router.use('/vessels', vesselRoutes);
router.use('/medical-centers', medicalCenterRoutes);
router.use('/assessments', assessmentRoutes);

// API info
router.get('/', (req, res) => {
  res.json({
    message: 'MOLMI Cadet Recruitment API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      institutes: '/api/institutes',
      activityLogs: '/api/activity-logs',
      users: '/api/users',
      rolePermissions: '/api/role-permissions',
      cadets: '/api/cadets',
      assessments: '/api/assessments',
    },
  });
});

module.exports = router;
