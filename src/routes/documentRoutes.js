const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const documentController = require('../controllers/documentController');

router.use(authMiddleware);

router.get('/drive', documentController.getDriveDocuments);
router.post('/request-upload', documentController.requestDocumentUpload);
router.post('/cadet/:cadet_id', upload.single('document'), documentController.uploadCadetDocument);
router.put('/:id/review', documentController.reviewDocument);
router.get('/:id/download', documentController.downloadDocument);
router.delete('/:id', documentController.deleteDocument);

module.exports = router;
