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
const authRoutes = require('./routes/authRoutes');
const instituteRoutes = require('./src/routes/instituteRoutes');
const cadetRoutes = require('./src/routes/cadetRoutes');
const cvRoutes = require('./routes/cvRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/institutes', instituteRoutes);
app.use('/api/cadets', cadetRoutes);
app.use('/api/cv', cvRoutes);

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
