const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const service = require('../src/services/passwordResetService');
const { emailTemplates } = require('../src/services/emailService');

const response = () => ({
  code: 200,
  headers: {},
  set(name, value) { this.headers[name] = value; return this; },
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});

function harness({ hash, mail } = {}) {
  let now = 0;
  const users = [{ id: 'user-one', email: 'one@example.test', password: 'original', status: 'active' }];
  const sent = [];
  const logs = [];
  let requests = [];
  const dao = {
    findUserByEmail: async (email) => users.find((user) => user.email === email),
    issuePasswordResetToken: async (id, tokenHash) => {
      const user = users.find((item) => item.id === id);
      if (!user || user.status !== 'active') return { issued: false };
      const recent = requests.filter((item) => item.id === id && item.at > now - 14400000);
      if (recent.length >= 5) return { issued: false, limitReached: true, retryAfterSeconds: Math.ceil((recent[0].at + 14400000 - now) / 1000) };
      if (user.requestedAt !== undefined && now - user.requestedAt < 60000) return { issued: false };
      Object.assign(user, { tokenHash, expiresAt: now + 900000, requestedAt: now });
      requests.push({ id, tokenHash, at: now });
      return { issued: true };
    },
    findUserByPasswordResetToken: async (tokenHash) => users.find((user) =>
      user.tokenHash === tokenHash && user.expiresAt > now && user.status === 'active'),
    consumePasswordResetToken: async (id, tokenHash, password) => {
      const user = users.find((item) => item.id === id && item.tokenHash === tokenHash && item.expiresAt > now && item.status === 'active');
      if (!user) return false;
      user.password = password;
      delete user.tokenHash;
      delete user.expiresAt;
      delete user.requestedAt;
      return true;
    },
    revokePasswordResetToken: async (id, tokenHash) => {
      requests = requests.filter((item) => item.id !== id || item.tokenHash !== tokenHash);
      const user = users.find((item) => item.id === id && item.tokenHash === tokenHash);
      if (user) { delete user.tokenHash; delete user.expiresAt; delete user.requestedAt; }
    },
  };
  const module = { exports: {} };
  const mocks = {
    bcryptjs: { hash: hash || (async (value) => `hashed:${value}`) },
    jsonwebtoken: {},
    '../dao/userDao': dao,
    '../dao/instituteDao': {},
    '../services/emailService': {
      emailTemplates,
      sendEmail: async (options) => { if (mail) await mail(options); sent.push(options); },
    },
    '../dao/activityLogDao': { createLog: async (...args) => logs.push(args) },
    '../config/constants': { FRONTEND_URL: 'https://cadet.molminavis.com', BCRYPT_SALT_ROUNDS: 10 },
    '../utils/validationUtils': require('../src/utils/validationUtils'),
    '../services/passwordResetService': service,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/authController.js'), 'utf8'), {
    module, console: { error() {} }, require: (name) => {
      assert.ok(name in mocks, `Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  return {
    controller: module.exports, users, sent, logs,
    advance: (milliseconds) => { now += milliseconds; },
    async request(email = 'one@example.test') {
      const res = response();
      await module.exports.forgotPassword({ body: { email }, ip: '127.0.0.1' }, res);
      return res;
    },
    token: () => /token=([a-f0-9]{64})/.exec(sent.filter((item) => item.subject.includes('Action Required')).at(-1).text)[1],
    async reset(token, extra = {}) {
      const res = response();
      await module.exports.resetPassword({ body: { token, password: 'NewPass123', confirm_password: 'NewPass123', ...extra } }, res);
      return res;
    },
  };
}

test('legacy user-ID-only links and malformed tokens cannot change any password', async () => {
  const h = harness();
  for (const token of [undefined, '', 'user-one', {}, 'a'.repeat(63), 'g'.repeat(64)]) {
    const res = await h.reset(token, { userId: 'user-one' });
    assert.equal(res.code, 400);
    assert.equal(res.body.code, 'INVALID_RESET_TOKEN');
    assert.equal(h.users[0].password, 'original');
  }
  assert.equal(h.sent.length, 0);
});

test('forgot password emails an unpredictable token and stores only its hash', async () => {
  const h = harness();
  const res = await h.request(' one@example.test ');
  const token = h.token();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(h.users[0].tokenHash, service.hashPasswordResetToken(token));
  assert.notEqual(h.users[0].tokenHash, token);
  assert.equal(h.sent[0].to, 'one@example.test');
  assert.match(h.sent[0].html, /expires in 15 minutes/);
  assert.match(h.sent[0].html, /used only once/);
  assert.doesNotMatch(h.sent[0].html, /reset-password\?id=/);
  assert.ok(!JSON.stringify(res.body).includes(token));
  assert.ok(!JSON.stringify(h.logs).includes(token));
  assert.notEqual(service.createPasswordResetToken(), service.createPasswordResetToken());
});

test('validating a link does not consume it; resetting consumes it exactly once', async () => {
  const h = harness();
  await h.request();
  const token = h.token();
  for (let i = 0; i < 2; i++) {
    const res = response();
    await h.controller.validateResetToken({ body: { token } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal((await h.reset(token)).code, 200);
  assert.equal(h.users[0].password, 'hashed:NewPass123');
  assert.equal((await h.reset(token, { password: 'Another123', confirm_password: 'Another123' })).code, 400);
  assert.equal(h.users[0].password, 'hashed:NewPass123');
  assert.equal(h.users[0].tokenHash, undefined);
  assert.equal(h.sent.length, 2);
});

test('expired and unknown tokens are rejected without changing a password', async () => {
  const h = harness();
  await h.request();
  const token = h.token();
  h.advance(900000);
  assert.equal((await h.reset(token)).code, 400);
  assert.equal((await h.reset(service.createPasswordResetToken())).code, 400);
  assert.equal(h.users[0].password, 'original');
});

test('resend cooldown suppresses repeated mail; a fresh request replaces the old link', async () => {
  const h = harness();
  await h.request();
  const oldToken = h.token();
  await h.request();
  assert.equal(h.sent.length, 1);
  h.advance(60000);
  await h.request();
  const newToken = h.token();
  assert.notEqual(newToken, oldToken);
  assert.equal((await h.reset(oldToken)).code, 400);
  assert.equal((await h.reset(newToken)).code, 200);
  await h.request();
  assert.equal((await h.reset(h.token())).code, 200, 'a new Forgot Password request works after a reset');
});

test('changing the submitted user ID cannot redirect a valid token to another account', async () => {
  const h = harness();
  h.users.push({ id: 'user-two', email: 'two@example.test', password: 'unchanged', status: 'active' });
  await h.request();
  assert.equal((await h.reset(h.token(), { userId: 'user-two' })).code, 200);
  assert.equal(h.users[0].password, 'hashed:NewPass123');
  assert.equal(h.users[1].password, 'unchanged');
});

test('invalid password input does not consume a valid link', async () => {
  const h = harness();
  await h.request();
  const token = h.token();
  assert.equal((await h.reset(token, { confirm_password: 'Different123' })).code, 400);
  assert.equal((await h.reset(token, { password: 'short', confirm_password: 'short' })).code, 400);
  assert.equal((await h.reset(token)).code, 200);
});

test('two simultaneous reset submissions permit only one password update', async () => {
  const h = harness();
  await h.request();
  const results = await Promise.all([h.reset(h.token()), h.reset(h.token())]);
  assert.deepEqual(results.map((res) => res.code).sort(), [200, 400]);
  assert.equal(h.logs.filter((row) => row[1] === 'PASSWORD_RESET').length, 1);
});

test('expiry is checked again when consuming a token after password hashing', async () => {
  let releaseHash;
  const h = harness({ hash: () => new Promise((resolve) => { releaseHash = resolve; }) });
  await h.request();
  const pending = h.reset(h.token());
  await new Promise((resolve) => setImmediate(resolve));
  h.advance(900000);
  releaseHash('hashed:new');
  assert.equal((await pending).code, 400);
  assert.equal(h.users[0].password, 'original');
});

test('nonexistent and inactive accounts return the same public message', async () => {
  const h = harness();
  const known = await h.request();
  const unknown = await h.request('missing@example.test');
  h.users[0].status = 'inactive';
  const inactive = await h.request();
  assert.equal(unknown.code, known.code);
  assert.equal(unknown.body.message, known.body.message);
  assert.equal(inactive.body.message, known.body.message);
  assert.equal(h.sent.length, 1);
});

test('failed reset-email delivery revokes the undelivered token', async () => {
  const h = harness({ mail: async () => { throw new Error('smtp unavailable'); } });
  const res = await h.request();
  assert.equal(res.code, 500);
  assert.equal(h.users[0].tokenHash, undefined);
  assert.equal(h.users[0].requestedAt, undefined);
  assert.ok(!JSON.stringify(res.body).includes('smtp unavailable'));
});

test('five reset emails are allowed in a rolling four-hour window; the sixth is blocked', async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) {
    assert.equal((await h.request()).code, 200);
    h.advance(60000);
  }
  const latestToken = h.token();
  const blocked = await h.request();
  assert.equal(blocked.code, 429);
  assert.equal(blocked.body.code, 'PASSWORD_RESET_LIMIT_REACHED');
  assert.equal(blocked.body.message, service.PASSWORD_RESET_LIMIT_MESSAGE);
  assert.equal(blocked.body.retryAfterSeconds, 14100);
  assert.equal(blocked.headers['Retry-After'], '14100');
  assert.equal(h.sent.length, 5);
  assert.equal(h.users[0].tokenHash, service.hashPasswordResetToken(latestToken));
  h.advance(14099999);
  assert.equal((await h.request()).code, 429, 'still blocked just before the oldest request expires');
  h.advance(1);
  assert.equal((await h.request()).code, 200, 'one slot opens when the oldest request is four hours old');
  assert.equal(h.sent.length, 6);
  assert.equal((await h.request()).code, 429, 'the other four requests still count in the rolling window');
});

test('password resets cannot bypass the email limit and each account has its own allowance', async () => {
  const h = harness();
  h.users.push({ id: 'user-two', email: 'two@example.test', status: 'active' });
  for (let i = 0; i < 5; i++) {
    await h.request();
    assert.equal((await h.reset(h.token())).code, 200);
  }
  assert.equal((await h.request()).code, 429);
  assert.equal((await h.request('two@example.test')).code, 200);
  assert.equal(h.sent.filter((item) => item.subject.includes('Action Required')).length, 6);
});

test('failed delivery and cooldown-suppressed attempts do not consume the five-email allowance', async () => {
  let failing = true;
  const h = harness({ mail: async () => { if (failing) throw new Error('SMTP unavailable'); } });
  for (let i = 0; i < 6; i++) assert.equal((await h.request()).code, 500);
  failing = false;
  for (let i = 0; i < 5; i++) {
    assert.equal((await h.request()).code, 200);
    if (i < 4) {
      for (let repeat = 0; repeat < 10; repeat++) assert.equal((await h.request()).code, 200);
    }
    h.advance(60000);
  }
  assert.equal(h.sent.length, 5);
  assert.equal((await h.request()).code, 429);
});

test('notification failure after a successful reset still reports success', async () => {
  const h = harness({ mail: async (options) => { if (options.subject === 'Password Reset Successful') throw new Error('notification unavailable'); } });
  await h.request();
  assert.equal((await h.reset(h.token())).code, 200);
  assert.equal(h.users[0].password, 'hashed:NewPass123');
  assert.equal(h.users[0].tokenHash, undefined);
});
