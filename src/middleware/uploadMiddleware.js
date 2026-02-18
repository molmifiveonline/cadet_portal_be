const multer = require('multer');

// Configure storage — keep in memory for saving to database
const storage = multer.memoryStorage();

// Create upload middleware
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

module.exports = upload;
