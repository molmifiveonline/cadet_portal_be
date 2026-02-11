const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const db = require('./db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Basic Route
app.get('/', (req, res) => {
  res.send('Backend is running');
});

// API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/institutes', require('./routes/instituteRoutes'));
app.use('/api/batches', require('./routes/batchRoutes'));
app.use('/api/cadets', require('./routes/cadetRoutes'));
app.use('/api/cv', require('./routes/cvRoutes'));

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
