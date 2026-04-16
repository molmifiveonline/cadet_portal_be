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
const interviewRoutes = require('./interviewRoutes');
const medicalRoutes = require('./medicalRoutes');
const recruitmentDriveRoutes = require('./recruitmentDriveRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const documentRoutes = require('./documentRoutes');

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
router.use('/interviews', interviewRoutes);
router.use('/medical-results', medicalRoutes);
router.use('/recruitment-drives', recruitmentDriveRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/documents', documentRoutes);

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
      recruitmentDrives: '/api/recruitment-drives',
      documents: '/api/documents',
    },
  });
});

module.exports = router;
