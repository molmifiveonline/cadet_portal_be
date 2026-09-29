const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Opt in with ACTIVITY_LOG_DB_TESTS=1. Copy structures into uniquely named test
// tables, route every query to those tables, and stub all email delivery.
test('allocation and master actions appear in Activity Logs', {
  skip: process.env.ACTIVITY_LOG_DB_TESTS !== '1',
}, async (t) => {
  const db = require('../src/config/database');
  const connection = await db.getConnection();
  const physicalQuery = connection.query.bind(connection);
  const originalQuery = db.query;
  const originalGetConnection = db.getConnection;
  const emailService = require('../src/services/emailService');
  const originalSendEmail = emailService.sendEmail;
  const prefix = `audit_test_${randomUUID().replace(/-/g, '').slice(0, 12)}_`;
  const tables = [
    'activity_logs', 'users', 'institutes', 'cadets', 'cadet_documents',
    'document_verifications', 'vessel_types', 'vessels', 'assessment_courses',
    'score_formula_templates', 'score_formula_components', 'allocation_year_sequences',
    'allocation_cycles', 'allocation_rank_lists', 'allocations', 'allocation_score_entries',
    'allocation_rank_history', 'joining_plans', 'allocation_communications', 'onboarding',
  ];
  const tablePattern = new RegExp(`\\b(${tables.join('|')})\\b`, 'g');
  const query = (sql, values) => physicalQuery(sql.replace(tablePattern, (table) => prefix + table), values);
  const quote = (value) => '`' + value.replace(/`/g, '``') + '`';
  const createdTables = [];
  const rows = async (sql, values = []) => (await query(sql, values))[0];
  try {
    for (const table of tables) {
      await physicalQuery(`CREATE TABLE ${quote(prefix + table)} LIKE ${quote(table)}`);
      createdTables.push(prefix + table);
    }
    db.query = query;
    db.getConnection = async () => ({
      query, beginTransaction: connection.beginTransaction.bind(connection),
      commit: connection.commit.bind(connection), rollback: connection.rollback.bind(connection),
      release() {},
    });
    emailService.sendEmail = async () => { throw new Error('Simulated email failure; no email sent'); };
    const allocation = require('../src/controllers/allocationController');
    const vessel = require('../src/controllers/vesselController');
    const master = require('../src/controllers/allocationMasterController');
    const onboarding = require('../src/controllers/onboardingController');
    const logs = require('../src/dao/activityLogDao');
    // Rejected requests are asserted below; suppress their expected error output.
    t.mock.method(console, 'error', () => {});
    await query(`INSERT INTO users (id,email,password,role,first_name,last_name,status)
      VALUES ('audit-user','audit@example.invalid','unused','SuperAdmin','Audit','Tester','active')`);

    const invoke = async (handler, { body = {}, params = {}, action, details, status = 200 } = {}) => {
      const before = new Set((await rows('SELECT id FROM activity_logs')).map((row) => row.id));
      const res = {
        statusCode: 200,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; return this; },
      };
      await handler({ body, params, query: {}, user: { id: 'audit-user', role: 'SuperAdmin' }, ip: '127.0.0.1' },
        res, (error) => { throw error; });
      assert.equal(res.statusCode, status, JSON.stringify(res.body));
      const added = (await rows('SELECT * FROM activity_logs')).filter((row) => !before.has(row.id));
      assert.equal(added.length, action ? 1 : 0, `Unexpected logs for ${action || 'rejected/no-op request'}`);
      if (action) {
        assert.equal(added[0].action, action);
        assert.equal(added[0].user_id, 'audit-user');
        assert.equal(added[0].ip_address, '127.0.0.1');
        assert.ok(added[0].created_at);
        assert.doesNotMatch(added[0].details, /undefined/);
        if (details) assert.match(added[0].details, details);
      }
      return res.body.data;
    };

    let typeId;
    let courseId;
    const cycles = {};
    const lists = {};
    const candidates = {};
    await t.test('Vessel Type create, edit, deactivate and activate; invalid changes leave no success log', async () => {
      const created = await invoke(vessel.createVesselMasterType, {
        body: { name: 'Audit Type', department: 'Both' }, action: 'CREATE_VESSEL_TYPE', status: 201,
      });
      typeId = created.id;
      await invoke(vessel.updateVesselMasterType, { params: { id: typeId },
        body: { name: 'Audit Vessel Type', department: 'Both' }, action: 'UPDATE_VESSEL_TYPE', details: /Audit Type to Audit Vessel Type/ });
      for (const status of ['Inactive', 'Active']) {
        await invoke(vessel.setVesselMasterTypeStatus, { params: { id: typeId }, body: { status },
          action: status === 'Active' ? 'ACTIVATE_VESSEL_TYPE' : 'DEACTIVATE_VESSEL_TYPE' });
      }
      await invoke(vessel.setVesselMasterTypeStatus, { params: { id: typeId }, body: { status: 'Invalid' }, status: 400 });
      await invoke(vessel.createVesselMasterType, { body: { name: 'Audit Vessel Type' }, status: 409 });
    });

    await t.test('Assessment Type and formula changes are searchable by their names', async () => {
      const course = await invoke(master.saveCourse, { body: { name: 'Audit Assessment' }, action: 'CREATE_ASSESSMENT_TYPE', status: 201 });
      courseId = course.id;
      await invoke(master.saveCourse, { params: { id: courseId }, body: { name: 'Audit Score' }, action: 'UPDATE_ASSESSMENT_TYPE' });
      for (const status of ['Inactive', 'Active']) {
        await invoke(master.saveCourse, { params: { id: courseId }, body: { name: 'Audit Score', status },
          action: status === 'Active' ? 'ACTIVATE_ASSESSMENT_TYPE' : 'DEACTIVATE_ASSESSMENT_TYPE' });
      }
      const unused = await invoke(master.saveCourse, { body: { name: 'Unused Assessment' }, action: 'CREATE_ASSESSMENT_TYPE', status: 201 });
      await invoke(master.deleteCourse, { params: { id: unused.id }, action: 'DELETE_ASSESSMENT_TYPE' });
      const formula = await invoke(master.createFormula, { body: {
        name: 'Audit Formula', department: 'Deck', academic_weight: 50,
        components: [{ course_id: courseId, weight: 50, max_score: 100 }],
      }, action: 'CREATE_SCORE_FORMULA', status: 201 });
      await invoke(master.activateFormula, { params: { id: formula.id }, action: 'ACTIVATE_SCORE_FORMULA', details: /Deck.*Audit Formula/ });
    });

    await t.test('Department creation and candidate additions identify the allocation and cadets', async () => {
      for (const department of ['Deck', 'Engine']) {
        const cycle = await invoke(allocation.createCycle, { body: { year: 2090, department }, action: 'CREATE_CTV_ALLOCATION', status: 201, details: new RegExp(department) });
        cycles[department] = cycle;
        [lists[department]] = await rows('SELECT * FROM allocation_rank_lists WHERE cycle_id=?', [cycle.id]);
        const cadetIds = department === 'Deck' ? ['deck-one', 'deck-two'] : ['engine-one'];
        for (const [index, id] of cadetIds.entries()) {
          await query(`INSERT INTO cadets (id,institute_id,cadet_unique_id,name_as_in_indos_cert,email_id,course,status,workflow_phase,imu_avg_all_semester_percentage)
            VALUES (?,'audit-institute',?,?,?,?,'Selected','selected',80)`, [id, id, `Test ${id}`, `${id}@example.invalid`, department]);
          await query("INSERT INTO document_verifications (id,cadet_id,status) VALUES (?,?,'Verified')", [`verify-${id}`, id]);
          await query("INSERT INTO cadet_documents (id,cadet_id,document_name,document_type,status) VALUES (?,?,'Test Document','Other','accepted')", [`doc-${id}`, id]);
        }
        const added = await invoke(allocation.addCandidates, { params: { rankListId: lists[department].id }, body: {
          candidates: cadetIds.map((cadet_id, index) => ({ cadet_id, scores: [{ course_id: courseId, score: 80 + index * 10 }] })),
        }, action: 'ADD_CTV_CANDIDATES', status: 201, details: new RegExp(`${department} allocation ${cycle.allocation_number}`) });
        candidates[department] = added.added;
        const details = await invoke(allocation.getCycle, { params: { id: cycle.id } });
        assert.ok(details.rank_lists[0].formula_snapshot.components.every((component) => component.max_score === 100));
        for (const item of details.rank_lists[0].allocations) {
          assert.equal(Number(item.scores[0].max_score_snapshot), 100);
          assert.equal(Number(item.final_score), (80 + Number(item.scores[0].score)) / 2);
        }
        await query(`INSERT INTO vessels (id,name,imo_number,vessel_type_id,vessel_type,department,status,total_seats)
          VALUES (?,?,?,?,?,?,'Active',20)`, [`vessel-${department}`, `Audit ${department} Ship`, `IMO-${department}`, typeId, 'Audit Vessel Type', department]);
      }
      await invoke(allocation.createCycle, { body: { year: 2090, department: 'Both' }, status: 400 });
    });

    await t.test('Scores, vessel assignments, rank changes, rank resets and removals log details', async () => {
      const deckId = candidates.Deck[0].allocation_id;
      for (const score of [0, 100, 72.5, 70]) {
        await invoke(allocation.updateScores, { params: { allocationId: deckId }, body: { scores: [{ course_id: courseId, score }] },
          action: 'UPDATE_CTV_SCORES', details: new RegExp(`Audit Score: .*to ${score}`) });
        const [saved] = await rows('SELECT final_score FROM allocations WHERE id=?', [deckId]);
        assert.equal(Number(saved.final_score), (80 + score) / 2);
      }
      for (const score of [-1, 100.01, 101, '', null]) {
        await invoke(allocation.updateScores, { params: { allocationId: deckId }, body: { scores: [{ course_id: courseId, score }] }, status: 400 });
      }
      for (const department of ['Deck']) {
        await invoke(allocation.updateVesselAllocation, { params: { allocationId: candidates[department][0].allocation_id }, body: {
          vessel_id: `vessel-${department}`, vessel_type_id: typeId, allocation_status: 'Allocated',
        }, action: 'UPDATE_CTV_VESSEL_ALLOCATION', details: new RegExp(`Audit ${department} Ship`) });
      }
      await invoke(allocation.moveRank, { params: { allocationId: deckId }, body: { direction: 'up', target_rank: 1, remarks: 'Review priority' },
        action: 'MOVE_CTV_RANK', details: /from rank 2 to 1.*Review priority/ });
      await invoke(allocation.resetRanks, { params: { rankListId: lists.Deck.id }, body: { remarks: 'Restore score order' },
        action: 'RESET_CTV_RANKS', details: /Deck.*Restore score order/ });
      await invoke(allocation.removeCandidate, { params: { allocationId: candidates.Deck[1].allocation_id }, action: 'REMOVE_CTV_CANDIDATE', details: /deck-two.*Deck/ });
      for (const department of ['Deck', 'Engine']) {
        await invoke(allocation.finalizeRankList, { params: { rankListId: lists[department].id }, body: { remarks: 'Checked' },
          action: 'FINALIZE_CTV_RANK_LIST', details: new RegExp(department) });
      }
      await invoke(allocation.updateScores, { params: { allocationId: deckId }, body: { scores: [] }, status: 409 });
      const [engineCadet] = await rows('SELECT status FROM cadets WHERE id=?', ['engine-one']);
      assert.equal(engineCadet.status, 'Selected');
    });

    await t.test('Joining plans, communications and failed email attempts have distinct entries', async () => {
      const request = { params: { allocationId: candidates.Deck[0].allocation_id }, body: {
        vessel_role: 'Primary', joining_date: '2090-01-01', reporting_port: 'Test Port', contact_person_name: 'Test Contact',
      } };
      const plan = await invoke(allocation.createJoiningPlan, { ...request, action: 'CREATE_CTV_JOINING_PLAN', status: 201, details: /Primary.*Deck allocation/ });
      await invoke(allocation.createJoiningPlan, { ...request, status: 201 });
      const date = new Date().toISOString().slice(0, 10);
      for (const mode of ['Phone', 'WhatsApp', 'Email']) {
        await invoke(allocation.recordCommunication, { params: { joiningPlanId: plan.id }, body: { mode, date_of_informing: date, confirmation_received: true },
          action: mode === 'Email' ? 'CTV_COMMUNICATION_FAILED' : 'RECORD_CTV_COMMUNICATION', status: mode === 'Email' ? 502 : 201,
          details: new RegExp(mode === 'Email' ? 'Failed Email attempt' : `Recorded ${mode}`) });
      }
    });

    await t.test('finalized lists allow vessel changes while preserving ranks and reviewing affected joining plans', async () => {
      const deckId = candidates.Deck[0].allocation_id;
      const before = await rows('SELECT id,final_score,current_rank FROM allocations ORDER BY id');
      await invoke(allocation.updateVesselAllocation, { params: { allocationId: candidates.Engine[0].allocation_id }, body: {
        vessel_id: 'vessel-Engine', vessel_type_id: typeId, allocation_status: 'Allocated',
      }, action: 'UPDATE_CTV_VESSEL_ALLOCATION' });
      const [engineCadet] = await rows('SELECT status FROM cadets WHERE id=?', ['engine-one']);
      assert.equal(engineCadet.status, 'CTV Assigned');
      for (const id of ['deck-replacement', 'deck-secondary', 'deck-full']) {
        await query(`INSERT INTO vessels (id,name,imo_number,vessel_type_id,vessel_type,department,status,total_seats)
          VALUES (?,?,?,?,'Audit Vessel Type','Deck','Active',?)`, [id, id, id, typeId, id === 'deck-full' ? 0 : 20]);
      }
      const assignments = {
        vessel_id: 'vessel-Deck', vessel_type_id: typeId, allocation_status: 'Allocated',
        secondary_vessel_id: 'deck-secondary', secondary_vessel_type_id: typeId, secondary_allocation_status: 'Allocated',
      };
      await invoke(allocation.updateVesselAllocation, { params: { allocationId: deckId }, body: assignments, action: 'UPDATE_CTV_VESSEL_ALLOCATION' });
      let [plan] = await rows('SELECT * FROM joining_plans WHERE allocation_id=?', [deckId]);
      assert.equal(plan.requires_refresh, 0, 'Changing Secondary must not invalidate the Primary plan');
      const oldContacts = await rows('SELECT * FROM allocation_communications WHERE joining_plan_id=? ORDER BY id', [plan.id]);
      await invoke(allocation.updateVesselAllocation, { params: { allocationId: deckId }, body: { ...assignments, vessel_id: 'deck-replacement' }, action: 'UPDATE_CTV_VESSEL_ALLOCATION' });
      [plan] = await rows('SELECT * FROM joining_plans WHERE id=?', [plan.id]);
      assert.equal(plan.requires_refresh, 1);
      assert.equal(plan.status, 'Needs Review');
      const date = new Date().toISOString().slice(0, 10);
      await invoke(allocation.recordCommunication, { params: { joiningPlanId: plan.id }, body: { mode: 'Phone', date_of_informing: date }, status: 409 });
      let visible = await invoke(allocation.listJoiningPlans);
      assert.equal(visible.find((item) => item.id === plan.id).successful_communication_count, 0);
      const revised = await invoke(allocation.createJoiningPlan, { params: { allocationId: deckId }, body: {
        vessel_role: 'Primary', joining_date: '2090-02-01', reporting_port: 'Updated Port', contact_person_name: 'Updated Contact',
      }, action: 'UPDATE_CTV_JOINING_PLAN', status: 201, details: /vessel-Deck|Audit Deck Ship/ });
      assert.equal(revised.id, plan.id);
      assert.equal(revised.vessel_name, 'deck-replacement');
      assert.equal(revised.requires_refresh, 0);
      assert.equal(revised.revision, 2);
      assert.deepEqual(await rows('SELECT * FROM allocation_communications WHERE joining_plan_id=? ORDER BY id', [plan.id]), oldContacts);
      visible = await invoke(allocation.listJoiningPlans);
      assert.equal(visible.find((item) => item.id === plan.id).successful_communication_count, 0);
      await invoke(allocation.recordCommunication, { params: { joiningPlanId: plan.id }, body: { mode: 'Phone', date_of_informing: date },
        action: 'RECORD_CTV_COMMUNICATION', status: 201 });
      visible = await invoke(allocation.listJoiningPlans);
      assert.equal(visible.find((item) => item.id === plan.id).successful_communication_count, 1);
      for (const [vessel_id, status] of [['vessel-Engine', 400], ['deck-full', 409]]) {
        await invoke(allocation.updateVesselAllocation, { params: { allocationId: deckId }, body: { ...assignments, vessel_id }, status });
      }
      await invoke(allocation.moveRank, { params: { allocationId: deckId }, body: { direction: 'down', remarks: 'Blocked after finalize' }, status: 409 });
      await invoke(allocation.resetRanks, { params: { rankListId: lists.Deck.id }, body: { remarks: 'Blocked after finalize' }, status: 409 });
      await invoke(allocation.removeCandidate, { params: { allocationId: deckId }, status: 409 });
      assert.deepEqual(await rows('SELECT id,final_score,current_rank FROM allocations ORDER BY id'), before);
      assert.ok((await rows('SELECT status FROM allocation_rank_lists')).every((list) => list.status === 'Finalized'));
    });

    await t.test('Onboarding changes, unlocking and deletion retain department context', async () => {
      const [record] = await rows('SELECT id FROM onboarding WHERE allocation_id=?', [candidates.Deck[0].allocation_id]);
      await invoke(onboarding.updateChecklist, { params: { id: record.id }, body: { passport_verified: true },
        action: 'UPDATE_CADET_ONBOARDING', details: /Deck allocation.*passport verified: Yes/ });
      await invoke(onboarding.updateChecklist, { params: { id: record.id }, body: {
        passport_verified: true, medical_cert_verified: true, bank_details_verified: true, agreement_signed: true, final_clearance: true,
      }, action: 'COMPLETE_CADET_ONBOARDING', details: /Deck allocation/ });
      await invoke(allocation.updateVesselAllocation, { params: { allocationId: candidates.Deck[0].allocation_id }, body: {
        vessel_id: 'vessel-Deck', vessel_type_id: typeId, allocation_status: 'Allocated',
      }, status: 409 });
      await invoke(allocation.unlockRankList, { params: { rankListId: lists.Engine.id }, body: { remarks: 'Review Engine list' },
        action: 'UNLOCK_CTV_RANK_LIST', details: /Engine.*Review Engine list/ });
      await invoke(allocation.unlockRankList, { params: { rankListId: lists.Deck.id }, body: { remarks: 'Not allowed after onboarding' }, status: 409 });
      const empty = await invoke(allocation.createCycle, { body: { year: 2090, department: 'Engine' }, action: 'CREATE_CTV_ALLOCATION', status: 201 });
      await invoke(allocation.deleteCycle, { params: { id: empty.id }, action: 'DELETE_CTV_ALLOCATION', details: /Engine allocation/ });
      const visible = await logs.getLogsLast3Months(100, 0, cycles.Deck.allocation_number);
      assert.ok(visible.length > 5);
      assert.ok(visible.every((log) => log.display_name === 'Audit Tester'));
      assert.ok(visible.every((log) => log.details.includes('Deck')));
      assert.equal(await logs.countLogsLast3Months(cycles.Deck.allocation_number), visible.length);
    });

    await t.test('allocation details retain finalize and unlock remarks across repeated finalization', async () => {
      const engine = await invoke(allocation.getCycle, { params: { id: cycles.Engine.id } });
      const engineList = engine.rank_lists[0];
      assert.equal(engineList.status, 'Draft');
      assert.equal(engineList.admin_remarks_history.length, 2);
      assert.ok(engineList.admin_remarks_history.some((event) => event.action === 'Finalize' && event.remarks === 'Checked'));
      assert.ok(engineList.admin_remarks_history.some((event) => event.action === 'Unlock' && event.remarks === 'Review Engine list'));
      assert.ok(engineList.admin_remarks_history.every((event) => event.changed_by_name === 'Audit Tester' && event.created_at));

      await invoke(allocation.finalizeRankList, { params: { rankListId: lists.Engine.id }, body: { remarks: 'Engine review complete' },
        action: 'FINALIZE_CTV_RANK_LIST', details: /Engine review complete/ });
      const finalized = await invoke(allocation.getCycle, { params: { id: cycles.Engine.id } });
      assert.equal(finalized.rank_lists[0].status, 'Finalized');
      assert.equal(finalized.rank_lists[0].admin_remarks_history.length, 3);
      assert.ok(finalized.rank_lists[0].admin_remarks_history.some((event) => event.remarks === 'Engine review complete'));
      for (const event of engineList.admin_remarks_history) {
        assert.ok(finalized.rank_lists[0].admin_remarks_history.some((item) => item.id === event.id && item.remarks === event.remarks));
      }
      assert.deepEqual(finalized.rank_lists[0].allocations[0].rank_history, []);

      const deck = await invoke(allocation.getCycle, { params: { id: cycles.Deck.id } });
      assert.equal(deck.rank_lists[0].admin_remarks_history.length, 2);
      assert.ok(deck.rank_lists[0].admin_remarks_history.some((event) => event.action === 'Reset' && event.remarks === 'Restore score order'));
      assert.ok(deck.rank_lists[0].admin_remarks_history.every((event) => event.action !== 'Unlock'));
      assert.equal(deck.rank_lists[0].allocations[0].rank_history[0].remarks, 'Review priority');
    });

    await t.test('an audit entry written in a rolled-back transaction is not published', async () => {
      const before = await rows('SELECT id FROM activity_logs ORDER BY id');
      await connection.beginTransaction();
      await logs.createLog('audit-user', 'ROLLBACK_TEST', 'Must not be visible', '127.0.0.1', connection);
      await connection.rollback();
      assert.deepEqual(await rows('SELECT id FROM activity_logs ORDER BY id'), before);
    });
  } finally {
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
    emailService.sendEmail = originalSendEmail;
    await connection.rollback();
    if (/^audit_test_[a-f0-9]{12}_$/.test(prefix)) {
      for (const table of createdTables.reverse()) {
        assert.ok(table.startsWith(prefix) && tables.includes(table.slice(prefix.length)));
        await physicalQuery(`DROP TABLE ${quote(table)}`);
      }
    }
    connection.release();
    await db.end();
  }
});
