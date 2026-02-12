const multer = require('multer');

// Configure storage
const storage = multer.memoryStorage(); // Store files in memory for immediate processing

// Create upload middleware
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

module.exports = upload;
