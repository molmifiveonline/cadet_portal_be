const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./authRoutes');
const instituteRoutes = require('./instituteRoutes');

// Use routes
router.use('/auth', authRoutes);
router.use('/institutes', instituteRoutes);

// API info
router.get('/', (req, res) => {
  res.json({
    message: 'MOLMI Cadet Recruitment API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      institutes: '/api/institutes',
      batches: '/api/batches',
      cadets: '/api/cadets',
      cv: '/api/cv',
    },
  });
});

module.exports = router;
