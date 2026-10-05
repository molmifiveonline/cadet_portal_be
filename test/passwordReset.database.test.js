const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const service = require('../src/services/passwordResetService');

const load = (file, mocks) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    module, console: { error() {} }, require(name) {
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return module.exports;
};

test('password reset HTTP flow enforces expiry, single use and the rolling email limit in MySQL',
  { skip: process.env.PASSWORD_RESET_DB_TESTS !== '1' }, async () => {
    require('dotenv').config({ quiet: true });
    const mysql = require('mysql2/promise');
    const express = require('express');
    const db = mysql.createPool({
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER, password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME, connectionLimit: 3, connectTimeout: 10000,
    });
    const table = `password_reset_test_${crypto.randomBytes(8).toString('hex')}`;
    const requestTable = `${table}_requests`;
    const scopedSQL = (sql) => sql.replace(/\busers\b/g, table).replace(/\bpassword_reset_requests\b/g, requestTable);
    const query = (sql, values) => db.query(scopedSQL(sql), values);
    const getConnection = async () => {
      const connection = await db.getConnection();
      return {
        query: (sql, values) => connection.query(scopedSQL(sql), values),
        beginTransaction: () => connection.beginTransaction(),
        commit: () => connection.commit(),
        rollback: () => connection.rollback(),
        release: () => connection.release(),
      };
    };
    const schema = { ensurePasswordResetSupport: async () => {} };
    const mail = [];
    let server;
    try {
      await db.query(`CREATE TABLE ${table} (
        id CHAR(36) PRIMARY KEY, email VARCHAR(255), password VARCHAR(255),
        status VARCHAR(20), role VARCHAR(30), first_name VARCHAR(30), last_name VARCHAR(30),
        password_reset_token_hash CHAR(64) NULL UNIQUE,
        password_reset_expires_at DATETIME(3) NULL,
        password_reset_requested_at DATETIME(3) NULL
      ) ENGINE=InnoDB`);
      await db.query(`CREATE TABLE ${requestTable} (
        token_hash CHAR(64) PRIMARY KEY, user_id VARCHAR(36) NOT NULL,
        requested_at DATETIME(3) NOT NULL,
        KEY idx_user_time (user_id, requested_at)
      ) ENGINE=InnoDB`);
      const userId = crypto.randomUUID();
      const otherId = crypto.randomUUID();
      const originalPassword = await bcrypt.hash('Original123', 4);
      for (const [id, email] of [[userId, 'reset@example.test'], [otherId, 'other@example.test']]) {
        await query("INSERT INTO users (id,email,password,status,role) VALUES (?,?,?,'active','SuperAdmin')", [id, email, originalPassword]);
      }
      const dao = load('dao/userDao.js', {
        uuid: { v4: crypto.randomUUID }, '../config/database': { query, getConnection },
        '../services/schemaUpgradeService': schema, '../services/passwordResetService': service,
      });
      const controller = load('controllers/authController.js', {
        bcryptjs: bcrypt, jsonwebtoken: require('jsonwebtoken'), '../dao/userDao': dao,
        '../dao/instituteDao': {}, '../dao/activityLogDao': { createLog: async () => {} },
        '../config/constants': { FRONTEND_URL: 'https://cadet.molminavis.com', BCRYPT_SALT_ROUNDS: 4, JWT_SECRET: 'isolated-test-only', JWT_EXPIRE: '1h', ROLES: { CADET: 'Cadet' } },
        '../utils/validationUtils': require('../src/utils/validationUtils'),
        '../services/passwordResetService': service,
        '../services/emailService': { emailTemplates: require('../src/services/emailService').emailTemplates, sendEmail: async (options) => mail.push(options) },
      });
      const app = express();
      app.use(express.json());
      app.post('/forgot', controller.forgotPassword);
      app.post('/validate', controller.validateResetToken);
      app.post('/reset', controller.resetPassword);
      app.post('/login', controller.login);
      server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      const post = async (route, body) => {
        const result = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: result.status, retryAfter: result.headers.get('Retry-After'), body: await result.json() };
      };
      const request = () => post('/forgot', { email: 'reset@example.test' });
      const newestToken = () => /token=([a-f0-9]{64})/.exec(mail.filter((item) => item.subject.includes('Action Required')).at(-1).text)[1];
      const reset = (token, password = 'Changed123') => post('/reset', { token, userId: otherId, password, confirm_password: password });

      assert.equal((await post('/reset', { userId, password: 'BadFlow123', confirm_password: 'BadFlow123' })).status, 400);
      assert.equal((await request()).status, 200);
      const token = newestToken();
      const stored = await dao.findUserById(userId);
      assert.equal(stored.password_reset_token_hash, service.hashPasswordResetToken(token));
      assert.notEqual(stored.password_reset_token_hash, token);
      const requestEmailCount = mail.length;
      await request();
      assert.equal(mail.length, requestEmailCount, 'cooldown suppresses a second email');
      assert.equal((await post('/validate', { token })).status, 200);
      assert.equal((await post('/validate', { token })).status, 200);
      const outcomes = await Promise.all([reset(token), reset(token, 'SecondPass123')]);
      assert.deepEqual(outcomes.map((item) => item.status).sort(), [200, 400]);
      const winner = outcomes[0].status === 200 ? 'Changed123' : 'SecondPass123';
      assert.equal((await post('/login', { email: 'reset@example.test', password: winner })).status, 200);
      assert.equal((await post('/login', { email: 'reset@example.test', password: 'Original123' })).status, 401);
      assert.equal((await reset(token)).status, 400);
      assert.equal((await dao.findUserById(otherId)).password, originalPassword, 'the submitted userId cannot affect another account');

      await request();
      const expired = newestToken();
      await query('UPDATE users SET password_reset_expires_at = UTC_TIMESTAMP(3) WHERE id=?', [userId]);
      assert.equal((await post('/validate', { token: expired })).status, 400);
      assert.equal((await reset(expired)).status, 400);
      await query('UPDATE users SET password_reset_requested_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE id=?', [userId]);
      await request();
      const replaced = newestToken();
      await query('UPDATE users SET password_reset_requested_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE id=?', [userId]);
      await request();
      const replacement = newestToken();
      assert.notEqual(replacement, replaced);
      assert.equal((await reset(replaced)).status, 400);
      assert.equal((await reset(replacement, 'FinalPass123')).status, 200);

      await request();
      const pendingToken = newestToken();
      const management = load('dao/userManagementDao.js', {
        '../config/database': { query }, bcryptjs: bcrypt, uuid: { v4: crypto.randomUUID },
        '../services/schemaUpgradeService': schema,
      });
      await management.updateUser(userId, 'reset@example.test', 'Reset', 'Test', 'active', 'SuperAdmin', 'AdminChange123');
      assert.equal((await reset(pendingToken)).status, 400, 'a password changed by an admin invalidates pending reset links');
      assert.equal(await bcrypt.compare('AdminChange123', (await dao.findUserById(userId)).password), true);
      assert.equal((await dao.findUserById(otherId)).password, originalPassword);

      const beforeLimit = mail.length;
      const blocked = await request();
      assert.equal(blocked.status, 429, 'admin and successful password changes do not clear the email allowance');
      assert.equal(blocked.body.message, service.PASSWORD_RESET_LIMIT_MESSAGE);
      assert.ok(Number(blocked.retryAfter) > 0 && Number(blocked.retryAfter) <= 14400);
      assert.equal(mail.length, beforeLimit, 'blocked requests do not send mail');
      assert.equal((await post('/forgot', { email: 'other@example.test' })).status, 200, 'allowance is per account');

      // Expire exactly one slot, leaving four recent reservations.
      await query(`UPDATE password_reset_requests SET requested_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 4 HOUR)
        WHERE user_id = ? AND token_hash = ?`, [userId, service.hashPasswordResetToken(token)]);
      const concurrent = await Promise.all([request(), request(), request()]);
      assert.deepEqual(concurrent.map((item) => item.status).sort(), [200, 429, 429], 'only one of three competing requests can reserve the last slot');
      const afterRace = newestToken();
      const [recent] = await query('SELECT COUNT(*) AS total FROM password_reset_requests WHERE user_id = ?', [userId]);
      assert.equal(recent[0].total, 5, 'expired records are cleaned up and the allowance is never exceeded');
      const [otherRecent] = await query('SELECT COUNT(*) AS total FROM password_reset_requests WHERE user_id = ?', [otherId]);
      assert.equal(otherRecent[0].total, 1, 'cleanup preserves another account history');

      // Failed mail delivery returns its own slot and preserves newer links.
      await dao.revokePasswordResetToken(userId, service.hashPasswordResetToken(afterRace));
      assert.equal((await request()).status, 200, 'a failed delivery reservation can be reused');
      const delivered = newestToken();
      await dao.revokePasswordResetToken(userId, service.hashPasswordResetToken(afterRace));
      assert.equal((await post('/validate', { token: delivered })).status, 200, 'late failure cleanup cannot revoke a newer token');
      assert.equal((await request()).status, 429, 'late cleanup cannot refund a newer reservation');

      await query('UPDATE password_reset_requests SET requested_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 4 HOUR) WHERE user_id = ?', [userId]);
      await query('UPDATE users SET password_reset_requested_at = NULL WHERE id = ?', [userId]);

      // Legacy installations can store account status as a numeric column.
      await query("UPDATE users SET status='1'");
      await db.query(`ALTER TABLE ${table} MODIFY COLUMN status TINYINT`);
      await query('UPDATE users SET status=0 WHERE id=?', [otherId]);
      assert.equal((await dao.issuePasswordResetToken(otherId, service.hashPasswordResetToken(service.createPasswordResetToken()))).issued, false);
      assert.equal((await dao.issuePasswordResetToken(userId, service.hashPasswordResetToken(service.createPasswordResetToken()))).issued, true);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      assert.match(table, /^password_reset_test_[a-f0-9]{16}$/);
      assert.equal(requestTable, `${table}_requests`);
      await db.query(`DROP TABLE IF EXISTS ${requestTable}`);
      await db.query(`DROP TABLE IF EXISTS ${table}`);
      await db.end();
    }
  });
