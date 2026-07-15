const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { MAX_FILE_SIZE } = require('../config/constants');

const uploadLimits = {
  fileSize: MAX_FILE_SIZE.DOCUMENT || 5 * 1024 * 1024,
};

const memoryUploadLimits = {
  fileSize: MAX_FILE_SIZE.EXCEL || uploadLimits.fileSize,
};

// Configure disk storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

// Create upload middleware with limits from constants
const upload = multer({
  storage: storage,
  limits: uploadLimits,
});

upload.memory = multer({
  storage: multer.memoryStorage(),
  limits: memoryUploadLimits,
});

module.exports = upload;
