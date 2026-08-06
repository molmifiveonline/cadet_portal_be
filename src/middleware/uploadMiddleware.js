const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { MAX_FILE_SIZE } = require('../config/constants');

const uploadLimits = {
  fileSize: MAX_FILE_SIZE.DOCUMENT || 5 * 1024 * 1024,
};

const interviewUploadLimits = {
  fileSize: MAX_FILE_SIZE.INTERVIEW_DOCUMENT || 10 * 1024 * 1024,
};

const memoryUploadLimits = {
  fileSize: MAX_FILE_SIZE.EXCEL || uploadLimits.fileSize,
};

const uploadsDirectory = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadsDirectory, { recursive: true });

// Configure disk storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDirectory);
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

const createFileTypeError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const interviewSheetExtensions = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.jpg',
  '.jpeg',
  '.png',
]);
const interviewSheetMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]);

upload.interviewSheet = multer({
  storage,
  limits: interviewUploadLimits,
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (
      !interviewSheetExtensions.has(extension) ||
      !interviewSheetMimeTypes.has(file.mimetype)
    ) {
      return cb(
        createFileTypeError(
          'Interview sheets must be PDF, Word, JPG, or PNG files.',
        ),
      );
    }
    return cb(null, true);
  },
});

upload.handwrittenPdf = multer({
  storage,
  limits: interviewUploadLimits,
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (extension !== '.pdf' || file.mimetype !== 'application/pdf') {
      return cb(
        createFileTypeError('Handwritten interview notes must be a PDF file.'),
      );
    }
    return cb(null, true);
  },
});

upload.memory = multer({
  storage: multer.memoryStorage(),
  limits: memoryUploadLimits,
});

module.exports = upload;
