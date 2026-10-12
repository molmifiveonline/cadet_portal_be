const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function transporterConfig(env) {
  const logs = [];
  const module = { exports: {} };
  let options;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src/services/emailService.js'), 'utf8') + '\ncreateTransporter();',
    {
      module, process: { env },
      console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
      require(name) {
        if (name === 'nodemailer') return { createTransport: (config) => { options = config; return {}; } };
        if (name === '../utils/dateUtils') return { formatDateForDisplay: () => '' };
        if (name === '../utils/emailUtils') return { normalizeEmailRecipients: () => [] };
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  return { options, logs };
}

test('Gmail SMTP removes copied app-password spacing without logging credentials', () => {
  const { options, logs } = transporterConfig({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'test@example.test', SMTP_PASS: 'abcd efgh ijkl mnop' });
  assert.equal(options.auth.pass, 'abcdefghijklmnop');
  assert.equal(logs.length, 0);
});

test('Gmail service mode also removes app-password spacing', () => {
  const { options } = transporterConfig({ EMAIL_SERVICE: 'Gmail', EMAIL_USER: 'test@example.test', EMAIL_PASSWORD: 'abcd efgh ijkl mnop' });
  assert.equal(options.auth.pass, 'abcdefghijklmnop');
});

test('custom SMTP and other email services preserve password whitespace', () => {
  const password = ' secret password ';
  assert.equal(transporterConfig({ SMTP_HOST: 'smtp.example.test', SMTP_PASS: password }).options.auth.pass, password);
  assert.equal(transporterConfig({ EMAIL_SERVICE: 'Outlook', EMAIL_PASSWORD: password }).options.auth.pass, password);
});
