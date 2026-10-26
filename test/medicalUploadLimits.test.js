const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');

function load(relativePath, mocks = {}, directory) {
  const filename = path.join(__dirname, '../src', relativePath);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, process,
    __dirname: directory || path.dirname(filename),
    console: { error() {} },
    require: (name) => name in mocks ? mocks[name] : localRequire(name),
  });
  return module.exports;
}

test('medical multipart uploads enforce 10MB per file on the actual route', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'medical-upload-limits-'));
  const upload = load('middleware/uploadMiddleware.js', {}, path.join(directory, 'src/middleware'));
  const next = (req, res, proceed) => proceed();
  const controller = new Proxy({}, { get: (_, key) => key === 'saveMedicalResult'
    ? (req, res) => res.json({ files: req.files.map((file) => ({ name: file.originalname, size: file.size })) })
    : next });
  const router = load('routes/medicalRoutes.js', {
    '../middleware/uploadMiddleware': upload,
    '../controllers/medicalController': controller,
    '../middleware/authMiddleware': { authMiddleware: next },
    '../middleware/instituteOwnershipMiddleware': {
      blockInstitute: () => next, requireInstituteCadetOwnership: () => next,
    },
  });
  const app = express();
  app.use('/api/medical-results', router);
  app.post('/general-document', upload.single('document'), (req, res) => res.json({ success: true }));
  app.use(load('middleware/errorHandler.js'));
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const send = async (files, endpoint = '/api/medical-results/test-cadet', field = 'reports') => {
    const body = new FormData();
    files.forEach((file) => body.append(field, new Blob([file.bytes], { type: 'application/pdf' }), file.name));
    const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', body });
    return { status: response.status, body: await response.json() };
  };
  try {
    await t.test('accepts the reported 7.70MB PDF and preserves its name', async () => {
      const bytes = process.env.MEDICAL_UPLOAD_TEST_FILE
        ? fs.readFileSync(process.env.MEDICAL_UPLOAD_TEST_FILE) : Buffer.alloc(8069527);
      const name = process.env.MEDICAL_UPLOAD_TEST_FILE
        ? path.basename(process.env.MEDICAL_UPLOAD_TEST_FILE) : 'Medical Report.pdf';
      const result = await send([{ name, bytes }]);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.files, [{ name, size: bytes.length }]);
    });
    await t.test('accepts multiple reports whose combined size exceeds 10MB', async () => {
      const result = await send(['One.pdf', 'Two.pdf'].map((name) => ({ name, bytes: Buffer.alloc(6 * 1024 * 1024) })));
      assert.equal(result.status, 200);
      assert.equal(result.body.files.length, 2);
    });
    await t.test('rejects a report larger than 10MB with a specific message', async () => {
      const result = await send([{ name: 'Too large.pdf', bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }]);
      assert.equal(result.status, 400);
      assert.equal(result.body.message, 'Each medical report must be 10MB or smaller.');
    });
    await t.test('rejects more than 10 reports', async () => {
      const result = await send(Array.from({ length: 11 }, (_, index) => ({ name: `${index}.pdf`, bytes: Buffer.from('fixture') })));
      assert.equal(result.status, 400);
    });
    await t.test('keeps the general document limit at 5MB', async () => {
      const result = await send([{ name: 'Document.pdf', bytes: Buffer.alloc(6 * 1024 * 1024) }], '/general-document', 'document');
      assert.equal(result.status, 400);
      assert.equal(result.body.message, 'File too large. Please upload a smaller file.');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('medical-upload-limits-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
