const multer = require('multer');

// Configure memory storage for database storage
const storage = multer.memoryStorage();

// Create upload middleware
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

module.exports = upload;
