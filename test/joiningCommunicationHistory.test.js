const test = require('node:test');
const assert = require('node:assert/strict');

test('joining communication history reads only the requested plan', {
  skip: process.env.ALLOCATION_DB_TESTS !== '1',
}, async (t) => {
  const db = require('../src/config/database');
  const connection = await db.getConnection();
  const query = connection.query.bind(connection);
  try {
    await query('CREATE TEMPORARY TABLE joining_plans (id VARCHAR(36) PRIMARY KEY)');
    await query('CREATE TEMPORARY TABLE users (id VARCHAR(36) PRIMARY KEY, first_name VARCHAR(100), last_name VARCHAR(100), email VARCHAR(100))');
    await query(`CREATE TEMPORARY TABLE allocation_communications (
      id VARCHAR(36) PRIMARY KEY, joining_plan_id VARCHAR(36), plan_revision INT,
      mode VARCHAR(20), informed_by VARCHAR(36), date_of_informing DATE, informed_at DATETIME,
      confirmation_received TINYINT, candidate_remarks TEXT, admin_remarks TEXT,
      delivery_status VARCHAR(20), failure_reason TEXT, created_at DATETIME
    )`);
    await query("INSERT INTO joining_plans VALUES ('plan'),('other'),('empty')");
    await query("INSERT INTO users VALUES ('admin','Previous','Administrator','admin@example.invalid')");
    await query(`INSERT INTO allocation_communications VALUES
      ('old','plan',1,'Email','admin','2026-09-24','2026-09-24 10:00:00',0,'Old note','Old remarks','Failed','Mailbox unavailable','2026-09-24 10:00:00'),
      ('new','plan',2,'Phone','admin','2026-09-25','2026-09-25 11:00:00',1,'Confirmed arrival','Spoke to cadet',NULL,NULL,'2026-09-25 11:00:00'),
      ('unrelated','other',1,'WhatsApp','admin','2026-09-26','2026-09-26 09:00:00',0,'Private other plan',NULL,NULL,NULL,'2026-09-26 09:00:00')`);
    t.mock.method(db, 'query', query);
    t.mock.method(console, 'error', () => {});
    t.mock.method(require('../src/services/emailService'), 'sendEmail', async () => { throw new Error('History must never send an email'); });
    const { listJoiningPlanCommunications } = require('../src/controllers/allocationController');
    const invoke = async (id) => {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      await listJoiningPlanCommunications({ params: { joiningPlanId: id } }, res);
      return res;
    };
    const [before] = await query('SELECT * FROM allocation_communications ORDER BY id');

    await t.test('returns the recorded fields for all revisions, newest first', async () => {
      const res = await invoke('plan');
      assert.equal(res.code, 200);
      assert.deepEqual(res.body.data.map(row => row.id), ['new', 'old']);
      assert.equal(res.body.data[0].informed_by_name, 'Previous Administrator');
      assert.equal(res.body.data[0].date_of_informing, '2026-09-25');
      assert.equal(res.body.data[0].confirmation_received, 1);
      assert.equal(res.body.data[0].candidate_remarks, 'Confirmed arrival');
      assert.equal(res.body.data[0].admin_remarks, 'Spoke to cadet');
      assert.equal(res.body.data[1].plan_revision, 1);
      assert.equal(res.body.data[1].failure_reason, 'Mailbox unavailable');
    });
    await t.test('returns an empty history for a plan without contacts', async () => {
      const res = await invoke('empty');
      assert.equal(res.code, 200);
      assert.deepEqual(res.body.data, []);
    });
    await t.test('returns 404 for a missing plan', async () => {
      const res = await invoke('missing');
      assert.equal(res.code, 404);
    });

    const [after] = await query('SELECT * FROM allocation_communications ORDER BY id');
    assert.deepEqual(after, before);
  } finally {
    t.mock.restoreAll();
    connection.release();
    await db.end();
  }
});
