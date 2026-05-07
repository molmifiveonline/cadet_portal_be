require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

// Import routes
const routes = require("./src/routes");

// Import middleware
const errorHandler = require("./src/middleware/errorHandler");

// Import DAOs for background tasks
const activityLogDao = require("./src/dao/activityLogDao");

const app = express();
const PORT = process.env.PORT || 5000;

app.set("trust proxy", true);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (uploads)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

// API Routes
app.use("/api", routes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Health: http://localhost:${PORT}/health`);

  // Run initial cleanup of old activity logs
  activityLogDao.deleteOldLogs();

  // Schedule cleanup to run every 24 hours (24 * 60 * 60 * 1000 ms)
  setInterval(() => {
    activityLogDao.deleteOldLogs();
  }, 86400000);
});

module.exports = app;
