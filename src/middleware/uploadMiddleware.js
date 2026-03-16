const multer = require('multer');
const { MAX_FILE_SIZE } = require('../config/constants');

// Configure memory storage for database storage
const storage = multer.memoryStorage();

// Create upload middleware with limits from constants
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE.DOCUMENT || 5 * 1024 * 1024,
  },
});

module.exports = upload;
