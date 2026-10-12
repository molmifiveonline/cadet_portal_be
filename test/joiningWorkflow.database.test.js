const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

test(
  'joining workflow: migrations, revision history, delivery, ownership and onboarding',
  { skip: process.env.JOINING_WORKFLOW_DB_TESTS !== '1' },
  async (t) => {
    const db = require('../src/config/database');
    const { ensureJoiningWorkflow } = require('../src/services/joiningWorkflowSchema');
    const { createJoiningWorkflow, indiaToday } = require('../src/services/joiningWorkflowService');
    const { createJoiningEmailService } = require('../src/services/joiningEmailService');
    const { createJoiningWorkflowQueries } = require('../src/services/joiningWorkflowQueries');
    const prefix = `jwtest_${randomBytes(5).toString('hex')}_`;
    const base = [
      'users',
      'cadets',
      'allocation_cycles',
      'allocation_rank_lists',
      'allocations',
      'vessels',
      'vessel_types',
      'joining_plans',
      'allocation_communications',
      'onboarding',
      'allocation_score_entries',
      'allocation_rank_history',
      'institutes',
    ];
    const added = ['allocation_workflow_history', 'joining_email_attempts', 'allocation_workflow_migrations'];
    const pattern = new RegExp(`\\b(${[...base, ...added].join('|')})\\b`, 'g');
    const rewrite = (sql) =>
      sql
        .replace(pattern, (name) => prefix + name)
        .replace(/CONSTRAINT (\w+)/g, (_, name) => `CONSTRAINT ${prefix}${name}`);
    const database = {
      query: (sql, p) => db.query(rewrite(sql), p),
      getConnection: async () => {
        const c = await db.getConnection();
        return {
          query: (sql, p) => c.query(rewrite(sql), p),
          beginTransaction: () => c.beginTransaction(),
          commit: () => c.commit(),
          rollback: () => c.rollback(),
          release: () => c.release(),
        };
      },
    };
    const rows = async (sql, p) => (await database.query(sql, p))[0];
    const addColumn = async (table, column, definition) => {
      const [cols] = await db.query(`SHOW COLUMNS FROM ${prefix}${table} LIKE ?`, [column]);
      if (!cols.length) await db.query(`ALTER TABLE ${prefix}${table} ADD COLUMN ${column} ${definition}`);
    };
    const sent = [],
      logs = [];
    let delivery = 'Sent';
    const loadController = (file) => {
      const module = { exports: {} };
      require('node:vm').runInNewContext(
        fs.readFileSync(require.resolve('../src/controllers/' + file), 'utf8'),
        {
          module,
          console: { error() {} },
          process,
          Date,
          require: (name) =>
            name === '../config/database'
              ? database
              : name === '../dao/activityLogDao'
                ? { createLog: async (...args) => logs.push(args) }
                : name.startsWith('.')
                  ? require(require('node:path').resolve(__dirname, '../src/controllers', name))
                  : require(name),
        },
      );
      return module.exports;
    };
    const fs = require('node:fs');
    const allocations = loadController('allocationController.js'),
      onboarding = loadController('onboardingController.js');
    const invoke = async (fn, body = {}, params = {}) => {
      const res = {
        code: 200,
        status(code) {
          this.code = code;
          return this;
        },
        json(body) {
          this.body = body;
          return this;
        },
      };
      await fn({ params: { rankListId: 'rank', ...params }, body, query: {}, user: { id: 'admin' } }, res);
      return res;
    };
    const w = createJoiningWorkflow({
      database,
      permission: async () => false,
      log: async (...args) => logs.push(args),
      sendEmail: async (options) => {
        sent.push(options);
        if (delivery === 'Failed')
          throw Object.assign(new Error('Mock SMTP rejection'), { responseCode: 550 });
        if (delivery === 'Unknown') throw Object.assign(new Error('Mock timeout'), { code: 'ETIMEDOUT' });
        return { messageId: `mock-${sent.length}`, accepted: [options.to] };
      },
    });
    const email = createJoiningEmailService(w),
      query = createJoiningWorkflowQueries(w),
      admin = { id: 'admin' },
      owner = { id: 'owner' },
      other = { id: 'other' };
    const assignOwner = async (user, id, body) => {
      const [a] = await rows('SELECT follow_up_user_id FROM allocations WHERE id=?', [id]);
      return w.assign(user, id, {
        expected_follow_up_user_id: a.follow_up_user_id || null,
        remarks: 'Staff responsibility transfer',
        ...body,
      });
    };
    const saveBody = (role, vessel, version, extra = {}) => ({
      vessel_role: role,
      vessel_id: vessel,
      allocation_status: 'Allocated',
      expected_version: version,
      joining_details: {
        joining_date: '2026-11-12',
        reporting_port: 'Mumbai',
        contact_person_name: 'Coordinator',
        required_documents: ['Passport'],
      },
      ...extra,
    });
    const mailBody = (revision, key) => ({
      expected_revision: revision,
      request_key: key.padEnd(20, '-'),
      informed_by: 'admin',
      date_of_informing: indiaToday(),
      cc: ['copy@example.invalid'],
    });
    try {
      for (const table of base) await db.query(`CREATE TABLE ${prefix}${table} LIKE ${table}`);
      for (const [id, role] of [
        ['admin', 'SuperAdmin'],
        ['owner', 'Followup'],
        ['other', 'Followup'],
        ['cadet-account', 'Cadet'],
        ['institute-account', 'Institute'],
      ])
        await database.query(
          "INSERT INTO users (id,email,password,role,first_name,status) VALUES (?,?, 'unused',?,?, 'active')",
          [id, `${id}@example.invalid`, role, id],
        );
      await database.query(
        "INSERT INTO cadets (id,institute_id,name_as_in_indos_cert,cadet_unique_id,email_id,status,course) VALUES ('cadet','fixture-institute','Fixture Cadet','FIXTURE-C','cadet@example.invalid','Selected','Deck')",
      );
      await database.query(
        "INSERT INTO allocation_cycles (id,allocation_number,allocation_year,department) VALUES ('cycle','FIXTURE-2026',2026,'Deck')",
      );
      await database.query(
        "INSERT INTO allocation_rank_lists (id,cycle_id,department,formula_snapshot,status) VALUES ('rank','cycle','Deck','{}','Draft')",
      );
      await database.query(
        "INSERT INTO allocations (id,cadet_id,rank_list_id,is_active) VALUES ('allocation','cadet','rank',1)",
      );
      await database.query(
        "INSERT INTO vessel_types (id,name,department,status) VALUES ('type','General','Both','Active')",
      );
      for (const [id, seats] of [
        ['v1', 0],
        ['v2', null],
        ['v3', 1],
      ])
        await database.query(
          "INSERT INTO vessels (id,name,imo_number,vessel_type_id,department,status,total_seats) VALUES (?,?,?,'type','Both','Active',?)",
          [id, `Vessel ${id}`, id, seats],
        );
      // Exercise the additive DDL against the schema before this feature existed.
      for (const [table, cols] of [
        [
          'allocations',
          [
            'follow_up_user_id',
            'follow_up_assigned_by',
            'follow_up_assigned_at',
            'primary_plan_version',
            'secondary_plan_version',
          ],
        ],
        ['joining_plans', ['vessel_id']],
        ['allocation_communications', ['recorded_by', 'recorded_at']],
        ['onboarding', ['admission_source', 'admitted_at']],
      ]) {
        for (const col of cols) {
          const existing = await rows('SHOW COLUMNS FROM ' + table + ' LIKE ?', [col]);
          if (existing.length) await database.query('ALTER TABLE ' + table + ' DROP COLUMN ' + col);
        }
      }
      for (const [id, cadetStatus, onboardingStatus] of [
        ['legacy-pending', 'CTV Assigned', 'Pending'],
        ['legacy-complete', 'Onboarded', 'Onboarded'],
        ['old-ghost', 'Selected', 'Pending'],
      ]) {
        await database.query(
          "INSERT INTO cadets (id,institute_id,name_as_in_indos_cert,cadet_unique_id,status,course) VALUES (?,'fixture-institute',?,?,?,'Deck')",
          [id, id, id, cadetStatus],
        );
        await database.query(
          "INSERT INTO allocations (id,cadet_id,rank_list_id,is_active) VALUES (?,?,'rank',1)",
          [id, id],
        );
        await database.query(
          'INSERT INTO onboarding (id,cadet_id,allocation_id,status,passport_verified) VALUES (?,?,?,?,1)',
          [id, id, id, onboardingStatus],
        );
      }
      // Cover both vessel roles, including an existing checklist and a missing plan.
      for (const [id, role] of [
        ['legacy-primary', 'Primary'],
        ['legacy-secondary', 'Secondary'],
      ]) {
        await database.query(
          "INSERT INTO cadets (id,institute_id,name_as_in_indos_cert,cadet_unique_id,status,course) VALUES (?,'fixture-institute',?,?,'Selected','Deck')",
          [id, id, id],
        );
        const prefix = role === 'Primary' ? '' : 'secondary_';
        await database.query(
          `INSERT INTO allocations (id,cadet_id,rank_list_id,is_active,${prefix}vessel_id,${prefix}allocation_status) VALUES (?,?,'rank',1,'v1','Allocated')`,
          [id, id],
        );
      }
      await database.query(
        "INSERT INTO onboarding (id,cadet_id,allocation_id,status,passport_verified) VALUES ('legacy-primary','legacy-primary','legacy-primary','Pending',1)",
      );
      await ensureJoiningWorkflow(database, addColumn);
      await ensureJoiningWorkflow(database, addColumn);

      await t.test(
        'migration admits existing visible pending/completed cases only and preserves saved checks',
        async () => {
          const legacy = await rows('SELECT * FROM onboarding');
          assert.equal(legacy.find((r) => r.id === 'legacy-pending').admission_source, 'legacy');
          assert.equal(legacy.find((r) => r.id === 'legacy-complete').admission_source, 'legacy');
          assert.equal(legacy.find((r) => r.id === 'old-ghost').admission_source, null);
          assert.equal(legacy.find((r) => r.id === 'legacy-pending').passport_verified, 1);
          for (const id of ['legacy-primary', 'legacy-secondary']) {
            const o = legacy.find((r) => r.allocation_id === id);
            assert.equal(o.admission_source, 'allocation');
            assert.equal(o.status, 'Pending');
            assert.equal(
              (await rows('SELECT status FROM cadets WHERE id=?', [id]))[0].status,
              'CTV Assigned',
            );
            const [p] = await rows('SELECT * FROM joining_plans WHERE allocation_id=?', [id]);
            assert.equal(p.vessel_id, 'v1');
            assert.equal(p.revision, 1);
            assert.equal(p.vessel_role, id === 'legacy-primary' ? 'Primary' : 'Secondary');
          }
          assert.equal(legacy.find((r) => r.id === 'legacy-primary').passport_verified, 1);
          assert.equal((await rows('SELECT * FROM joining_email_attempts')).length, 0);
          assert.equal((await rows('SELECT * FROM allocation_communications')).length, 0);
          assert.equal(sent.length, 0);
          assert.equal((await rows('SELECT * FROM allocation_workflow_migrations')).length, 2);
          await database.query('DELETE FROM allocation_workflow_history');
          await database.query('DELETE FROM joining_plans');
          await database.query('DELETE FROM onboarding');
          await database.query("DELETE FROM allocations WHERE id<>'allocation'");
          await database.query("DELETE FROM cadets WHERE id<>'cadet'");
        },
      );
      await t.test(
        'saving either vessel in a draft list admits once without email and ignores seat counts',
        async () => {
          await w.save(admin, 'allocation', saveBody('Primary', 'v1', 0));
          assert.equal((await rows('SELECT * FROM onboarding')).length, 1);
          const [before] = await rows(
            "SELECT previous_cadet_status,previous_workflow_phase,previous_workflow_result FROM allocations WHERE id='allocation'",
          );
          await w.save(admin, 'allocation', saveBody('Secondary', 'v2', 0));
          const [after] = await rows(
            "SELECT previous_cadet_status,previous_workflow_phase,previous_workflow_result FROM allocations WHERE id='allocation'",
          );
          assert.deepEqual(after, before);
          assert.equal(sent.length, 0);
          assert.equal((await rows('SELECT * FROM onboarding')).length, 1);
          assert.equal((await rows('SELECT * FROM joining_plans')).length, 2);
        },
      );
      await t.test('follow-up ownership can be assigned before any joining email', async () => {
        await assignOwner(admin, 'allocation', { user_id: 'owner' });
        assert.equal((await query.list(owner, { mine: 'true' })).data.length, 1);
        assert.equal(sent.length, 0);
        await assignOwner(admin, 'allocation', { user_id: null });
      });
      await t.test(
        'queue includes either allocated vessel and excludes cadets with only non-allocated slots',
        async () => {
          for (const [primary, secondary, expected] of [
            ['Allocated', 'Pending', 1],
            ['Hold', 'Allocated', 1],
            ['Hold', 'Cancelled', 0],
          ]) {
            await database.query(
              "UPDATE allocations SET allocation_status=?,secondary_allocation_status=? WHERE id='allocation'",
              [primary, secondary],
            );
            const result = await query.list(admin, {});
            assert.equal(result.data.length, expected);
            assert.equal(result.pagination.total, expected);
          }
          await database.query(
            "UPDATE allocations SET allocation_status='Allocated',secondary_allocation_status='Allocated' WHERE id='allocation'",
          );
        },
      );
      await t.test(
        'finalizing and unlocking changes ranks only, without admission or plan invalidation',
        async () => {
          await database.query("UPDATE allocations SET final_score=80,current_rank=1 WHERE id='allocation'");
          const finalized = await invoke(allocations.finalizeRankList);
          assert.equal(finalized.code, 200, JSON.stringify(finalized.body));
          assert.equal((await rows('SELECT * FROM onboarding')).length, 1);
          const scoreEdit = await invoke(
            allocations.updateScores,
            { scores: [] },
            { allocationId: 'allocation' },
          );
          assert.equal(scoreEdit.code, 409);
          const unlocked = await invoke(allocations.unlockRankList, { remarks: 'Correct rank order' });
          assert.equal(unlocked.code, 200, JSON.stringify(unlocked.body));
          assert.ok(
            (await rows('SELECT * FROM joining_plans')).every((p) => !p.requires_refresh && p.revision === 1),
          );
          assert.equal((await rows("SELECT status FROM cadets WHERE id='cadet'"))[0].status, 'CTV Assigned');
        },
      );
      let primary = (await rows("SELECT * FROM joining_plans WHERE vessel_role='Primary'"))[0];
      const secondary = (await rows("SELECT * FROM joining_plans WHERE vessel_role='Secondary'"))[0];
      await t.test(
        'invalid saved recipients and CC are rejected without changing allocation admission',
        async () => {
          const body = mailBody(1, 'invalid-cc');
          await assert.rejects(
            email.send(admin, primary.id, { ...body, cc: ['not-an-email'] }),
            (e) => e.status === 400,
          );
          await database.query("UPDATE cadets SET email_id='invalid' WHERE id='cadet'");
          await assert.rejects(
            email.send(admin, primary.id, mailBody(1, 'invalid-recipient')),
            (e) => e.status === 400,
          );
          assert.equal(sent.length, 0);
          assert.equal((await rows('SELECT * FROM onboarding')).length, 1);
          await database.query("UPDATE cadets SET email_id='cadet@example.invalid' WHERE id='cadet'");
        },
      );
      await t.test(
        'failed sends preserve admission; retry records CC and duplicate request keys never send twice',
        async () => {
          await assignOwner(admin, 'allocation', { user_id: 'admin' });
          delivery = 'Failed';
          const failed = await email.send(admin, primary.id, mailBody(1, 'failed'));
          assert.equal(failed.status, 'Failed');
          assert.equal((await rows('SELECT * FROM onboarding')).length, 1);
          delivery = 'Sent';
          const body = mailBody(1, 'success');
          assert.equal((await email.send(admin, primary.id, body)).status, 'Sent');
          const count = sent.length;
          assert.equal((await email.send(admin, primary.id, body)).replayed, true);
          await assert.rejects(email.send(admin, secondary.id, body), (e) => e.status === 409);
          assert.equal(sent.length, count);
          assert.deepEqual(sent.at(-1).cc, ['copy@example.invalid']);
          assert.match(sent.at(-1).html, /Vessel v1/);
          const [o] = await rows('SELECT * FROM onboarding');
          assert.equal(o.admission_source, 'allocation');
          assert.equal(o.status, 'Pending');
          assert.equal((await rows("SELECT status FROM cadets WHERE id='cadet'"))[0].status, 'CTV Assigned');
        },
      );
      await t.test(
        'assignment gives only the chosen user access, including no scores and no sending permission',
        async () => {
          await assert.rejects(query.get(owner, 'allocation'), (e) => e.status === 403);
          assert.deepEqual((await w.staff(admin)).map((u) => u.id).sort(), ['admin', 'other', 'owner']);
          for (const user_id of ['cadet-account', 'institute-account']) {
            await assert.rejects(assignOwner(admin, 'allocation', { user_id }), (e) => e.status === 400);
          }
          await assignOwner(admin, 'allocation', { user_id: 'owner' });
          const a = await query.get(owner, 'allocation');
          assert.equal(a.abilities.can_edit, true);
          assert.equal(a.abilities.can_send, false);
          assert.equal('final_score' in a, false);
          assert.equal((await query.list(other, { mine: 'false' })).data.length, 0);
          await assert.rejects(
            email.send(owner, primary.id, mailBody(1, 'forbidden')),
            (e) => e.status === 403,
          );
        },
      );
      await t.test(
        'all manual modes are record-only and confirmation belongs to the plan revision',
        async () => {
          const count = sent.length;
          await assert.rejects(
            w.record(admin, secondary.id, {
              mode: 'Phone',
              informed_by: 'other',
              date_of_informing: indiaToday(),
              confirmation_received: true,
              expected_revision: 1,
            }),
            (e) => e.status === 409,
          );
          await w.record(admin, secondary.id, {
            mode: 'Phone',
            informed_by: 'owner',
            date_of_informing: indiaToday(),
            confirmation_received: true,
            expected_revision: 1,
          });
          const [attributed] = await rows(
            'SELECT recorded_by,informed_by FROM allocation_communications WHERE joining_plan_id=? AND delivery_status IS NULL',
            [secondary.id],
          );
          assert.equal(attributed.recorded_by, 'admin');
          assert.equal(attributed.informed_by, 'owner');
          assert.equal((await query.get(owner, 'allocation')).follow_up_user_id, 'owner');
          await assert.rejects(query.get(other, 'allocation'), (e) => e.status === 403);
          for (const mode of ['Email', 'Phone', 'WhatsApp'])
            await w.record(owner, primary.id, {
              mode,
              informed_by: 'owner',
              date_of_informing: indiaToday(),
              confirmation_received: true,
              expected_revision: 1,
              candidate_remarks: 'Available',
            });
          assert.equal(sent.length, count);
          const a = await query.get(owner, 'allocation');
          assert.equal(a.plans.find((p) => p.id === primary.id).confirmation_received, 1);
          assert.equal(a.plans.find((p) => p.id === primary.id).email_status, 'Sent');
          await assert.rejects(
            w.record(owner, primary.id, {
              mode: 'Phone',
              informed_by: 'admin',
              date_of_informing: indiaToday(),
              confirmation_received: true,
              expected_revision: 1,
            }),
            (e) => e.status === 409,
          );
        },
      );
      await t.test(
        'vessel/date changes need a reason, retain immutable history and onboarding checks, and preserve the other role',
        async () => {
          await database.query("UPDATE onboarding SET passport_verified=1 WHERE allocation_id='allocation'");
          await assert.rejects(
            w.save(owner, 'allocation', saveBody('Primary', 'v3', 1)),
            (e) => e.status === 400,
          );
          await w.save(
            owner,
            'allocation',
            saveBody('Primary', 'v3', 1, {
              change_reason: 'Cadet requested a later date',
              joining_details: {
                joining_date: '2026-11-18',
                reporting_port: 'Mumbai',
                contact_person_name: 'Coordinator',
              },
            }),
          );
          const a = await query.get(owner, 'allocation');
          primary = a.plans.find((p) => p.id === primary.id);
          assert.equal(primary.revision, 2);
          assert.equal(primary.confirmation_received, 0);
          assert.equal(a.plans.find((p) => p.id === secondary.id).confirmation_received, 1);
          assert.equal(primary.updated_email_pending, true);
          assert.equal(a.plans.find((p) => p.id === secondary.id).revision, 1);
          assert.equal((await rows('SELECT * FROM onboarding'))[0].passport_verified, 1);
          const h = await query.history(owner, 'allocation'),
            change = h.find((e) => e.reason === 'Cadet requested a later date');
          assert.equal(change.before_snapshot.vessel_name, 'Vessel v1');
          assert.equal(change.after_snapshot.vessel_name, 'Vessel v3');
          assert.ok(change.timestamp.endsWith('Z'));
          assert.equal(sent.length, 2);
          await assert.rejects(
            w.save(owner, 'allocation', saveBody('Primary', 'v1', 1, { change_reason: 'Stale' })),
            (e) => e.status === 409,
          );
          await assert.rejects(email.send(admin, primary.id, mailBody(1, 'stale')), (e) => e.status === 409);
        },
      );
      await t.test(
        'sending secondary does not duplicate onboarding; ownership changes take effect immediately',
        async () => {
          await database.query("UPDATE allocation_rank_lists SET status='Finalized' WHERE id='rank'");
          const body = { ...mailBody(1, 'secondary'), informed_by: 'owner' };
          const beforeCount = sent.length;
          await Promise.all([email.send(admin, secondary.id, body), email.send(admin, secondary.id, body)]);
          assert.equal(sent.length, beforeCount + 1);
          assert.equal((await rows('SELECT * FROM onboarding')).length, 1);
          await assignOwner(admin, 'allocation', { user_id: 'other' });
          await assert.rejects(query.get(owner, 'allocation'), (e) => e.status === 403);
          assert.equal((await query.get(other, 'allocation')).abilities.can_edit, true);
        },
      );
      await t.test('historical vessel references remain protected after replacement', async () => {
        const service = require('../src/services/allocationMasterDeletionService');
        const [v] = await rows(
          'SELECT ' +
            service.getAllocationMasterDependencySelect('vessel') +
            " FROM vessels m WHERE m.id='v1'",
        );
        assert.equal(v.has_allocations, 0);
        assert.equal(v.has_history, 1);
        assert.equal(service.getAllocationMasterDeletionInfo('vessel', v).can_delete, false);
      });
      await t.test(
        'onboarding uses edited details and completes in a draft rank list with an updated email pending',
        async () => {
          await database.query("UPDATE allocation_rank_lists SET status='Draft' WHERE id='rank'");
          const a = await query.get(admin, 'allocation');
          assert.equal(a.plans.find((p) => p.id === primary.id).updated_email_pending, true);
          const [o] = await rows('SELECT * FROM onboarding');
          const list = await invoke(onboarding.listOnboarding);
          assert.equal(list.code, 200, JSON.stringify(list.body));
          assert.equal(list.body.data[0].primary_vessel_name, 'Vessel v3');
          const complete = await invoke(
            onboarding.updateChecklist,
            {
              passport_verified: true,
              medical_cert_verified: true,
              bank_details_verified: true,
              agreement_signed: true,
              final_clearance: true,
            },
            { id: o.id },
          );
          assert.equal(complete.code, 200, JSON.stringify(complete.body));
          assert.equal(complete.body.data.status, 'Onboarded');
          // Reset this isolated fixture to exercise Hold and disabled protections too.
          await database.query("UPDATE onboarding SET status='Pending',final_clearance=0 WHERE id=?", [o.id]);
          await database.query(
            "UPDATE allocations SET allocation_status='Hold',secondary_allocation_status='Cancelled' WHERE id='allocation'",
          );
          assert.equal((await query.list(admin, {})).data.length, 0);
          await assert.rejects(
            w.record(admin, primary.id, {
              mode: 'Phone',
              expected_revision: 2,
              informed_by: 'admin',
              date_of_informing: indiaToday(),
              confirmation_received: false,
            }),
            (e) => e.status === 409,
          );
          const blocked = await invoke(onboarding.updateChecklist, { final_clearance: true }, { id: o.id });
          assert.equal(blocked.code, 409);
          assert.equal((await rows('SELECT * FROM onboarding'))[0].passport_verified, 1);
          await database.query(
            "UPDATE allocations SET allocation_status='Allocated',secondary_allocation_status='Allocated' WHERE id='allocation'",
          );
        },
      );
      await t.test('disabled and completed allocations reject writes', async () => {
        await database.query("UPDATE allocation_cycles SET deleted_at=NOW() WHERE id='cycle'");
        await assert.rejects(
          w.save(admin, 'allocation', saveBody('Primary', 'v3', 2)),
          (e) => e.status === 409,
        );
        await database.query("UPDATE allocation_cycles SET deleted_at=NULL WHERE id='cycle'");
        await database.query("UPDATE onboarding SET status='Onboarded' WHERE allocation_id='allocation'");
        await assert.rejects(
          w.save(admin, 'allocation', saveBody('Primary', 'v3', 2)),
          (e) => e.status === 409,
        );
        await database.query("UPDATE onboarding SET status='Pending' WHERE allocation_id='allocation'");
      });
      await t.test(
        'uncertain delivery is retained without automatic resend or admission changes',
        async () => {
          delivery = 'Unknown';
          const body = { ...mailBody(2, 'unknown'), informed_by: 'other' };
          assert.equal((await email.send(admin, primary.id, body)).status, 'Unknown');
          const count = sent.length;
          await email.send(admin, primary.id, body);
          assert.equal(sent.length, count);
          await assert.rejects(
            email.send(admin, primary.id, mailBody(2, 'another')),
            (e) => e.status === 409,
          );
        },
      );
      await t.test(
        'concurrent role saves reject stale edits and keep primary/secondary changes independent',
        async () => {
          const edits = await Promise.allSettled(
            ['A', 'B'].map((location) =>
              w.save(admin, 'allocation', saveBody('Primary', 'v3', 2, { joining_details: { location } })),
            ),
          );
          assert.equal(edits.filter((e) => e.status === 'fulfilled').length, 1);
          assert.equal(edits.find((e) => e.status === 'rejected').reason.status, 409);
          await Promise.all([
            w.save(
              admin,
              'allocation',
              saveBody('Primary', 'v3', 3, { joining_details: { location: 'Primary port' } }),
            ),
            w.save(
              admin,
              'allocation',
              saveBody('Secondary', 'v2', 1, { joining_details: { location: 'Secondary port' } }),
            ),
          ]);
          const a = await query.get(admin, 'allocation');
          assert.equal(a.plans.find((p) => p.vessel_role === 'Primary').location, 'Primary port');
          assert.equal(a.plans.find((p) => p.vessel_role === 'Secondary').location, 'Secondary port');
          const emailSnapshot = (await query.history(admin, 'allocation')).find(
            (h) => h.kind === 'email' && h.status === 'Sent',
          );
          assert.match(emailSnapshot.snapshot.joining_date, /^\d{4}-\d{2}-\d{2}$/);
        },
      );
      await t.test(
        'legacy plans marked for review can be saved without fabricating a date change',
        async () => {
          const before = await query.get(admin, 'allocation');
          const p = before.plans.find((p) => p.vessel_role === 'Secondary');
          await database.query('UPDATE joining_plans SET requires_refresh=1 WHERE id=?', [p.id]);
          const result = await w.save(admin, 'allocation', {
            vessel_role: 'Secondary',
            vessel_id: 'v2',
            allocation_status: 'Allocated',
            expected_version: before.secondary_plan_version,
            joining_details: {},
          });
          assert.equal(result.plan.requires_refresh, 0);
          assert.equal(result.plan.revision, p.revision + 1);
        },
      );
      await t.test(
        'allocation and follow-up person save together for either vessel and all assigned statuses',
        async () => {
          const sendsBefore = sent.length;
          for (const role of ['Primary', 'Secondary'])
            for (const status of ['Allocated', 'Hold', 'Cancelled']) {
              const id = `inline-${role}-${status}`;
              await database.query(
                "INSERT INTO cadets (id,institute_id,name_as_in_indos_cert,cadet_unique_id,status,course) VALUES (?,'fixture-institute',?,?,'Selected','Deck')",
                [id, id, id],
              );
              await database.query(
                "INSERT INTO allocations (id,cadet_id,rank_list_id,is_active) VALUES (?,?,'rank',1)",
                [id, id],
              );
              const body = saveBody(role, 'v1', 0, {
                allocation_status: status,
                follow_up_user_id: 'owner',
                expected_follow_up_user_id: null,
              });
              // An invalid owner must also roll back joining details and onboarding admission.
              await assert.rejects(
                w.save(admin, id, { ...body, follow_up_user_id: 'cadet-account' }),
                (e) => e.status === 400,
              );
              assert.equal((await rows('SELECT * FROM joining_plans WHERE allocation_id=?', [id])).length, 0);
              assert.equal((await rows('SELECT * FROM onboarding WHERE allocation_id=?', [id])).length, 0);
              assert.equal(
                (await rows('SELECT * FROM allocation_workflow_history WHERE allocation_id=?', [id])).length,
                0,
              );
              await w.save(admin, id, body);
              const saved = await query.get(owner, id);
              assert.equal(saved.follow_up_user_id, 'owner');
              assert.equal(saved.plans[0].allocation_status, status);
              assert.equal(saved.plans[0].revision, 1);
              assert.equal(
                (await rows('SELECT * FROM onboarding WHERE allocation_id=?', [id])).length,
                status === 'Allocated' ? 1 : 0,
              );
              assert.equal(
                (await rows('SELECT * FROM allocation_workflow_history WHERE allocation_id=?', [id])).length,
                2,
              );
              await assert.rejects(
                w.save(owner, id, {
                  ...body,
                  expected_version: 1,
                  expected_follow_up_user_id: 'owner',
                  follow_up_user_id: 'other',
                }),
                (e) => e.status === 403,
              );
              await assignOwner(admin, id, { user_id: 'other', expected_follow_up_user_id: 'owner' });
              await assert.rejects(
                assignOwner(admin, id, { user_id: 'owner', expected_follow_up_user_id: 'owner' }),
                (e) => e.status === 409,
              );
              await assert.rejects(
                w.save(admin, id, {
                  ...body,
                  expected_version: 1,
                  expected_follow_up_user_id: 'owner',
                  joining_details: { location: 'Stale edit' },
                }),
                (e) => e.status === 409,
              );
              const current = await query.get(other, id);
              assert.equal(current.follow_up_user_id, 'other');
              assert.equal(current.plans[0].revision, 1);
              assert.notEqual(current.plans[0].location, 'Stale edit');
            }
          assert.equal(sent.length, sendsBefore);
        },
      );
      await t.test(
        'only explicit reassignment changes responsibility and preserves earlier contacts and checks',
        async () => {
          const id = 'inline-Primary-Allocated';
          const before = await query.get(other, id),
            p = before.plans[0];
          await database.query("UPDATE cadets SET email_id='fixture@example.invalid' WHERE id=?", [id]);
          await database.query('UPDATE onboarding SET passport_verified=1 WHERE allocation_id=?', [id]);
          const contact = {
            mode: 'Phone',
            informed_by: 'other',
            expected_revision: p.revision,
            date_of_informing: indiaToday(),
            confirmation_received: true,
          };
          await w.record(other, p.id, contact);
          await assert.rejects(w.assign(admin, id, { user_id: 'owner' }), (e) => e.status === 400);
          await assert.rejects(
            w.assign(admin, id, { user_id: 'owner', expected_follow_up_user_id: 'other' }),
            (e) => e.status === 400,
          );
          await assert.rejects(
            w.assign(admin, id, {
              user_id: 'other',
              expected_follow_up_user_id: 'other',
              remarks: 'No change',
            }),
            (e) => e.status === 400,
          );
          await assert.rejects(
            w.assign(other, id, {
              user_id: 'owner',
              expected_follow_up_user_id: 'other',
              remarks: 'I cannot reassign',
            }),
            (e) => e.status === 403,
          );
          const staleSave = saveBody('Primary', 'v1', p.revision, {
            follow_up_user_id: 'owner',
            expected_follow_up_user_id: 'other',
          });
          await assert.rejects(w.save(admin, id, staleSave), (e) => e.status === 409);
          const sendsBefore = sent.length;
          await assert.rejects(
            email.send(admin, p.id, { ...mailBody(p.revision, 'spoof-owner'), informed_by: 'owner' }),
            (e) => e.status === 409,
          );
          await assert.rejects(
            w.record(admin, p.id, { ...contact, informed_by: 'owner' }),
            (e) => e.status === 409,
          );
          assert.equal((await query.get(other, id)).follow_up_user_id, 'other');
          const preview = await email.preview(admin, p.id, p.revision);
          assert.equal(preview.follow_up_user_name, 'other');
          await w.assign(admin, id, {
            user_id: 'owner',
            expected_follow_up_user_id: 'other',
            remarks: 'Current person is on leave',
          });
          await assert.rejects(query.get(other, id), (e) => e.status === 403);
          assert.ok(!(await query.list(other, { mine: 'true' })).data.some((a) => a.id === id));
          const after = await query.get(owner, id);
          assert.equal(after.plans[0].revision, p.revision);
          assert.equal(after.plans[0].confirmation_received, 1);
          assert.equal(
            (await rows('SELECT passport_verified FROM onboarding WHERE allocation_id=?', [id]))[0]
              .passport_verified,
            1,
          );
          const history = await query.history(owner, id);
          const reassigned = history.find(
            (h) => h.event_type === 'Reassigned' && h.reason === 'Current person is on leave',
          );
          assert.equal(reassigned.before_snapshot.user_id, 'other');
          assert.equal(reassigned.after_snapshot.user_id, 'owner');
          assert.equal(reassigned.actor_id, 'admin');
          assert.ok(
            history.some(
              (h) => h.kind === 'contact' && h.informed_by === 'other' && h.recorded_by === 'other',
            ),
          );
          await assert.rejects(w.record(admin, p.id, contact), (e) => e.status === 409);
          await w.assign(admin, id, {
            user_id: null,
            expected_follow_up_user_id: 'owner',
            remarks: 'Awaiting new coordinator',
          });
          await assert.rejects(w.record(admin, p.id, contact), (e) => e.status === 409);
          await assert.rejects(
            email.send(admin, p.id, mailBody(p.revision, 'no-owner')),
            (e) => e.status === 409,
          );
          assert.equal(sent.length, sendsBefore);
        },
      );
      await t.test(
        'confirmation filters use current manual responses before pagination and preserve scope',
        async () => {
          const sendsBefore = sent.length;
          const create = async (suffix, roles, followupUser = 'owner') => {
            const id = `filter-${suffix}`;
            await database.query(
              "INSERT INTO cadets (id,institute_id,name_as_in_indos_cert,cadet_unique_id,status,course) VALUES (?,'fixture-institute',?,?,'Selected','Deck')",
              [id, `Filter fixture ${suffix}`, id],
            );
            await database.query(
              "INSERT INTO allocations (id,cadet_id,rank_list_id,is_active,follow_up_user_id) VALUES (?,?,'rank',1,?)",
              [id, id, followupUser],
            );
            const plans = [];
          for (const role of roles)
            plans.push((await w.save(admin, id, saveBody(role, role === 'Primary' ? 'v1' : 'v2', 0))).plan);
            return { id, plans };
          };
          let contactId = 0;
          const contact = async (plan, confirmed, options = {}) => {
            await database.query(
              `INSERT INTO allocation_communications
              (id,joining_plan_id,plan_revision,informed_by,recorded_by,date_of_informing,mode,confirmation_received,delivery_status,recorded_at)
              VALUES (?,?,?,'owner','admin','2026-01-01','Email',?,?,?)`,
              [
                `filter-contact-${++contactId}`,
                plan.id,
                options.revision ?? plan.revision,
                confirmed,
                options.delivery ?? null,
                options.at || '2026-01-01 10:00:00',
              ],
            );
          };
          const primary = await create('primary', ['Primary']);
          const secondary = await create('secondary', ['Secondary']);
          const both = await create('both', ['Primary', 'Secondary']);
          const mixed = await create('mixed', ['Primary', 'Secondary']);
          const none = await create('none', ['Primary']);
          const missing = await create('missing', []);
          await database.query(
            "UPDATE allocations SET vessel_id='v1',allocation_status='Allocated' WHERE id=?",
            [missing.id],
          );
          const latestNo = await create('latest-no', ['Primary']);
          const oldRevision = await create('old-revision', ['Primary']);
          const sentOnly = await create('sent-only', ['Primary']);
          const otherOwner = await create('other-owner', ['Primary'], 'other');
          for (const p of [
            ...primary.plans,
            ...secondary.plans,
            ...both.plans,
            mixed.plans[0],
            ...otherOwner.plans,
          ])
            await contact(p, 1);
          await contact(latestNo.plans[0], 1);
          await contact(latestNo.plans[0], 0, { at: '2026-01-02 10:00:00' });
          await contact(oldRevision.plans[0], 1, { revision: 0 });
          await contact(sentOnly.plans[0], 1, { delivery: 'Sent' });
          // A later system email does not replace a manual confirmation.
          await contact(primary.plans[0], 0, { delivery: 'Sent', at: '2026-01-03 10:00:00' });
        const pipelinePlans = await invoke(allocations.listJoiningPlans);
        assert.equal(pipelinePlans.code, 200);
        const pipelinePlan = (fixture) => pipelinePlans.body.data.find((p) => p.id === fixture.plans[0].id);
        assert.equal(pipelinePlan(primary).confirmation_received, 1);
        assert.equal(pipelinePlan(latestNo).confirmation_received, 0);
        assert.equal(pipelinePlan(oldRevision).confirmation_received, null);
        assert.equal(pipelinePlan(sentOnly).confirmation_received, null);
          const options = { search: 'Filter fixture', mine: 'true', limit: '100' };
          const ids = (result) => result.data.map((a) => a.id).sort();
          const expectedConfirmed = [primary.id, secondary.id, both.id].sort();
          const expectedPending = [
            mixed.id,
            none.id,
            missing.id,
            latestNo.id,
            oldRevision.id,
            sentOnly.id,
          ].sort();
          assert.deepEqual(
            ids(await query.list(owner, { ...options, confirmation: 'confirmed' })),
            expectedConfirmed,
          );
          assert.deepEqual(
            ids(await query.list(owner, { ...options, confirmation: 'pending' })),
            expectedPending,
          );
          assert.deepEqual(
            ids(await query.list(owner, options)),
            [...expectedConfirmed, ...expectedPending].sort(),
          );
          const allConfirmed = await query.list(admin, {
            ...options,
            mine: 'false',
            confirmation: 'confirmed',
          });
          assert.deepEqual(ids(allConfirmed), [...expectedConfirmed, otherOwner.id].sort());
          // Neither a forged mine flag nor the status filter gives the assignee access to another user's cadet.
          assert.deepEqual(
            ids(await query.list(owner, { ...options, mine: 'false', confirmation: 'confirmed' })),
            expectedConfirmed,
          );
          assert.equal(
            (await query.list(owner, { ...options, cycle_id: 'another-cycle', confirmation: 'confirmed' }))
              .pagination.total,
            0,
          );
          for (const status of ['Hold', 'Cancelled', 'Pending']) {
            await database.query('UPDATE allocations SET secondary_allocation_status=? WHERE id=?', [
              status,
              mixed.id,
            ]);
            assert.equal(
              (await query.list(owner, { ...options, search: mixed.id, confirmation: 'confirmed' }))
                .pagination.total,
              1,
            );
          }
          await database.query("UPDATE allocations SET secondary_allocation_status='Allocated' WHERE id=?", [
            mixed.id,
          ]);
          const first = await query.list(owner, {
            ...options,
            confirmation: 'confirmed',
            limit: '1',
            page: '1',
          });
          const second = await query.list(owner, {
            ...options,
            confirmation: 'confirmed',
            limit: '1',
            page: '2',
          });
          assert.equal(first.pagination.total, 3);
          assert.equal(first.pagination.totalPages, 3);
          assert.equal(first.data.length, 1);
          assert.notEqual(first.data[0].id, second.data[0].id);
          const last = await query.list(owner, {
            ...options,
            confirmation: 'confirmed',
            limit: '1',
            page: '99',
          });
          assert.equal(last.pagination.page, 3);
          assert.equal(last.data.length, 1);
          const empty = await query.list(owner, {
            ...options,
            search: 'no-match',
            confirmation: 'pending',
            page: '99',
          });
          assert.equal(empty.pagination.page, 1);
          assert.equal(empty.pagination.total, 0);
          assert.deepEqual(empty.data, []);
          for (const invalid of ['unknown', ['confirmed'], "confirmed' OR 1=1"])
            await assert.rejects(query.list(owner, { confirmation: invalid }), (e) => e.status === 400);
          assert.equal(sent.length, sendsBefore);
        },
      );
      await t.test('allocation detail retains disable protection for inactive candidate history', async () => {
        await database.query('UPDATE allocations SET is_active=0');
        const detail = await invoke(allocations.getCycle, {}, { id: 'cycle' });
        assert.equal(detail.code, 200, JSON.stringify(detail.body));
        assert.ok(detail.body.data.rank_lists.every((list) => list.allocations.length === 0));
        const plans = await rows('SELECT COUNT(*) AS total FROM joining_plans');
        const admissions = await rows('SELECT COUNT(*) AS total FROM onboarding');
        assert.ok(plans[0].total > 0);
        assert.ok(admissions[0].total > 0);
        assert.equal(detail.body.data.existing_joining_plan_count, plans[0].total);
        assert.equal(detail.body.data.existing_onboarding_count, admissions[0].total);
      });
    } finally {
      for (const table of [...added].reverse().concat([...base].reverse()))
        await db.query(`DROP TABLE IF EXISTS ${prefix}${table}`);
      await db.end();
    }
  },
);
