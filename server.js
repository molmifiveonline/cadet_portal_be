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
const { warmCache } = require("./src/services/schemaCompatibilityService");
const {
  ensureSubmissionDriveContext,
  ensurePerformanceIndexes,
  ensureInstituteUploadFormatSupport,
  ensureMultipleInterviewersSupport,
  ensureEvaluationParametersSupport,
  ensureMedicalReportsSupport,
  ensureMultipleMedicalAppointmentsSupport,
} = require("./src/services/schemaUpgradeService");

const app = express();
const PORT = process.env.PORT || 5000;

app.set("trust proxy", true);

// CORS configuration
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((url) => url.trim())
  : [];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app")
      ) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Middleware
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

  // Ensure lightweight schema upgrades are applied before warming compatibility cache.
  ensureSubmissionDriveContext()
    .then(() => ensurePerformanceIndexes())
    .then(() => ensureInstituteUploadFormatSupport())
    .then(() => ensureMultipleInterviewersSupport())
    .then(() => ensureEvaluationParametersSupport())
    .then(() => ensureMedicalReportsSupport())
    .then(() => ensureMultipleMedicalAppointmentsSupport())
    .then(() => warmCache())
    .catch((error) => {
      console.error("Schema upgrade failed:", error.message);
      warmCache();
    });

  // Run initial cleanup of old activity logs
  activityLogDao.deleteOldLogs();

  // Schedule cleanup to run every 24 hours (24 * 60 * 60 * 1000 ms)
  setInterval(() => {
    activityLogDao.deleteOldLogs();
  }, 86400000);
});

module.exports = app;
