const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmailRecipients } = require('../src/utils/emailUtils');

test('normalizes comma-separated CC recipients and removes duplicates', () => {
  assert.deepEqual(
    normalizeEmailRecipients('manager@example.com, Admin@example.com, admin@example.com'),
    ['manager@example.com', 'Admin@example.com'],
  );
});

test('accepts CC recipients supplied as an array', () => {
  assert.deepEqual(normalizeEmailRecipients(['one@example.com', 'two@example.com']), [
    'one@example.com',
    'two@example.com',
  ]);
});

test('accepts named CC recipients for Nodemailer', () => {
  assert.deepEqual(
    normalizeEmailRecipients([
      { name: 'Jane Manager', email: 'jane@example.com' },
    ]),
    [{ name: 'Jane Manager', address: 'jane@example.com' }],
  );
});

test('accepts named CC recipients from multipart JSON', () => {
  assert.deepEqual(
    normalizeEmailRecipients(
      '[{"name":"Jane Manager","email":"jane@example.com"}]',
    ),
    [{ name: 'Jane Manager', address: 'jane@example.com' }],
  );
});

test('rejects invalid CC recipients', () => {
  assert.throws(
    () => normalizeEmailRecipients('valid@example.com, invalid-address'),
    /Invalid CC email address: invalid-address/,
  );
});
