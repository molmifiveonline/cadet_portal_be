const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./authRoutes');
const instituteRoutes = require('./instituteRoutes');
const activityLogRoutes = require('./activityLogRoutes');
const userManagementRoutes = require('./userManagementRoutes');
const rolePermissionRoutes = require('./rolePermissionRoutes');

// Use routes
router.use('/auth', authRoutes);
router.use('/institutes', instituteRoutes);
router.use('/activity-logs', activityLogRoutes);
router.use('/users', userManagementRoutes);
router.use('/role-permissions', rolePermissionRoutes);

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
      batches: '/api/batches',
      cadets: '/api/cadets',
      cv: '/api/cv',
    },
  });
});

module.exports = router;
