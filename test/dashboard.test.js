const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  readFilters,
  cadetScope,
  pageNumber,
  buildPipeline,
} = require('../src/services/dashboardScope');

test('dashboard filters validate dates, enum values and pagination', () => {
  assert.deepEqual(
    readFilters({
      driveId: 'all',
      batchYear: '2026',
      from: '2026-01-01',
      to: '2026-12-31',
      instituteId: 'spoofed',
    }),
    { batchYear: '2026', from: '2026-01-01', to: '2026-12-31' },
  );
  for (const query of [
    { stream: 'unknown' },
    { batchYear: 'abc' },
    { from: '2026-02-30' },
    { from: '2026-12-01', to: '2026-01-01' },
    { driveId: ['a', 'b'] },
  ])
    assert.throws(() => readFilters(query), { status: 400 });
  for (const value of ['0', '-1', '1x', '1.5', '9007199254740992'])
    assert.throws(() => pageNumber(value), { status: 400 });
  assert.equal(pageNumber(undefined), 1);
});

test('institute scoping cannot be replaced by filters and missing identities fail closed', () => {
  const scope = cadetScope(
    { driveId: "x' OR 1=1", stream: 'Deck', batchYear: '2026' },
    { role: 'Institute', instituteId: 'own-institute' },
  );
  assert.match(scope.sql, /c.institute_id = \?/);
  assert.equal(scope.params[0], 'own-institute');
  assert.ok(!scope.sql.includes("x' OR"));
  assert.throws(() => cadetScope({}, { role: 'Institute' }), { status: 403 });
  assert.deepEqual(cadetScope({}, { role: 'Cadet' }).params, ['__unlinked__']);
});

test('conversion rates handle empty cohorts and inconsistent historical records', () => {
  const stages = [{ key: 'applied' }, { key: 'shortlisted' }];
  assert.equal(
    buildPipeline(stages, { applied: 0, shortlisted: 0 })[1].conversionRate,
    null,
  );
  assert.equal(
    buildPipeline(stages, { applied: 5, shortlisted: 8 })[1].dropOffRate,
    null,
  );
  const result = buildPipeline(stages, { applied: 10, shortlisted: 8 })[1];
  assert.equal(result.conversionRate, 80);
  assert.equal(result.dropOffRate, 20);
});

function loadDao(db, schema = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src/dao/dashboardDao.js'), 'utf8'),
    {
      module,
      console,
      require(name) {
        if (name === '../config/database') return db;
        if (name === '../utils/dateUtils') return require('../src/utils/dateUtils');
        if (name === '../services/schemaCompatibilityService')
          return {
            hasTable: async () => true,
            hasColumn: async () => true,
            ...schema,
          };
        if (name === '../services/dashboardScope')
          return require('../src/services/dashboardScope');
        throw new Error(`Unexpected import ${name}`);
      },
    },
  );
  return module.exports;
}

test('dashboard recent activity uses the same UTC timestamp as Activity Logs', async () => {
  const dao = loadDao({ query: async (sql) => {
    if (sql.includes('FROM activity_logs')) {
      assert.match(sql, /UNIX_TIMESTAMP\(created_at\) AS created_at/);
      return [[{ id: 'log-1', action: 'TEST', details: 'Test event', created_at: '1790752784' }]];
    }
    return [[]];
  } });
  const result = await dao.getDashboardStats({}, { role: 'SuperAdmin', canViewActivity: true });
  assert.equal(result.recentActivity[0].created_at, '2026-09-30T07:19:44.000Z');
});

test('fleet summary counts active vessels without treating recorded seats as availability', async () => {
  const dao = loadDao({ query: async (sql) => {
    if (sql.includes('FROM vessels')) {
      assert.doesNotMatch(sql, /total_seats|available_seats|reserved|openSlots|FROM allocations/);
      assert.match(sql, /COUNT\(\*\) AS activeVessels/);
      return [[{ activeVessels: 3 }]];
    }
    return [[]];
  } });
  const result = await dao.getDashboardStats({}, { role: 'SuperAdmin', canViewFleet: true });
  assert.equal(result.fleet.activeVessels, 3);
});

test('every candidate query is scoped and paginated totals are independent of returned rows', async () => {
  const calls = [];
  const dao = loadDao({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('COUNT(*) AS total FROM')) return [[{ total: 12 }]];
      if (sql.includes('AS totalCandidates'))
        return [[{ totalCandidates: 12, totalInstitutes: 1, applied: 12 }]];
      return [[]];
    },
  });
  const result = await dao.getDashboardStats(
    { driveId: 'drive', stream: 'Engine', batchYear: '2026' },
    { role: 'Institute', instituteId: 'institute' },
    { documents: 3, ctv: 2, onboarding: 1 },
  );
  assert.equal(result.pendingDocuments.total, 12);
  assert.equal(result.pendingDocuments.page, 3);
  assert.equal(result.pendingDocuments.rows.length, 0);
  const candidateCalls = calls.filter(({ sql }) =>
    /FROM cadets c|JOIN cadets c/.test(sql),
  );
  assert.ok(candidateCalls.length > 8);
  for (const call of candidateCalls) {
    assert.match(call.sql, /c.institute_id = \?/);
    assert.ok(call.params.includes('institute'));
  }
  assert.ok(
    calls
      .filter(({ sql }) => sql.includes('LIMIT 5 OFFSET'))
      .every(
        ({ params }) => params.includes('drive') && params.includes('Engine'),
      ),
  );
  assert.ok(
    !calls.some(
      ({ sql }) =>
        sql.includes('FROM vessels') || sql.includes('FROM activity_logs'),
    ),
  );
  const readiness = calls.find(({ sql }) =>
    sql.includes("dv.status='Verified'"),
  );
  assert.match(readiness.sql, /COALESCE\(cd.status,''\) <> 'accepted'/);
  assert.match(readiness.sql, /ac.status='Active'/);
});

test('cadet resolution uses current database identity and rejects ambiguous matches', async () => {
  for (const [rows, expected] of [
    [[], null],
    [[{ id: 'c1' }], 'c1'],
    [[{ id: 'c1' }, { id: 'c2' }], null],
  ]) {
    const dao = loadDao({
      query: async (sql, params) => {
        assert.match(sql, /JOIN users u/);
        assert.equal(params[0], 'user');
        return [rows];
      },
    });
    assert.equal(await dao.resolveCadetId('user'), expected);
  }
});

test('stage drill-down applies the same institute, drive and stream scope', async () => {
  const calls = [];
  const dao = loadDao({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return sql.includes('COUNT(*)') ? [[{ total: 17 }]] : [[]];
    },
  });
  const result = await dao.getStageCandidates(
    { driveId: 'drive', stream: 'Deck' },
    { role: 'Institute', instituteId: 'own' },
    'medical',
    2,
  );
  assert.equal(result.total, 17);
  for (const { sql, params } of calls) {
    assert.match(sql, /medical_passed/);
    assert.match(sql, /c.institute_id = \?/);
    assert.deepEqual(Array.from(params).slice(0, 3), ['own', 'drive', 'Deck']);
  }
  assert.equal(calls[1].params.at(-1), 10);
  await assert.rejects(dao.getStageCandidates({}, {}, 'injected', 1), {
    status: 400,
  });
});

test('database connection failures reject instead of returning a misleading empty dashboard', async () => {
  const dao = loadDao({
    query: async () => {
      throw Object.assign(new Error('Unavailable'), { code: 'ECONNREFUSED' });
    },
  });
  await assert.rejects(dao.getDashboardStats({}, { role: 'SuperAdmin' }), {
    code: 'ECONNREFUSED',
  });
});

function loadController(dao, db = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../src/controllers/dashboardController.js'),
      'utf8',
    ),
    {
      module,
      console: { error() {} },
      require(name) {
        if (name === '../dao/dashboardDao') return dao;
        if (name === '../config/database') return db;
        if (name === '../dao/rolePermissionDao')
          return { userHasPermission: async () => false };
        if (name === '../services/dashboardScope')
          return require('../src/services/dashboardScope');
        throw new Error(`Unexpected import ${name}`);
      },
    },
  );
  return module.exports;
}
const response = () => ({
  statusCode: 200,
  status(value) {
    this.statusCode = value;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('controller derives institute identity from the authenticated user, ignoring query overrides', async () => {
  let captured;
  const controller = loadController({
    getDashboardStats: async (filters, access) => {
      captured = { filters, access };
      return {};
    },
  });
  const res = response();
  await controller.getStats(
    {
      user: { id: 'own', role: 'Institute' },
      query: { instituteId: 'other', cadetId: 'other', driveId: 'drive' },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(captured.access.instituteId, 'own');
  assert.equal(captured.filters.instituteId, undefined);
});

test('personal upload enforces ownership and never updates another cadet document', async () => {
  const writes = [];
  const connection = {
    beginTransaction: async () => {},
    rollback: async () => {},
    release() {},
    query: async (sql, params) => {
      writes.push({ sql, params });
      return [[]];
    },
  };
  const controller = loadController(
    { resolveCadetId: async () => 'own-cadet' },
    { getConnection: async () => connection },
  );
  const res = response();
  await controller.uploadDocument(
    {
      user: { id: 'user', role: 'Cadet' },
      params: { id: 'foreign-document' },
      file: {
        size: 10,
        mimetype: 'application/pdf',
        buffer: Buffer.from('pdf'),
      },
    },
    res,
  );
  assert.equal(res.statusCode, 404);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /id=\? AND cadet_id=\? FOR UPDATE/);
  assert.equal(writes[0].params[1], 'own-cadet');
});

test('personal uploads lock accepted documents and roll back failed updates', async () => {
  for (const status of ['accepted', 'pending']) {
    let committed = false;
    let rolledBack = false;
    let updateCount = 0;
    const connection = {
      beginTransaction: async () => {},
      release() {},
      rollback: async () => {
        rolledBack = true;
      },
      commit: async () => {
        committed = true;
      },
      query: async (sql) => {
        if (sql.startsWith('SELECT'))
          return [
            [
              {
                id: 'doc',
                status,
                original_filename:
                  status === 'accepted' ? 'approved.pdf' : null,
                has_data: 0,
              },
            ],
          ];
        updateCount++;
        throw new Error('Simulated failed write');
      },
    };
    const controller = loadController(
      { resolveCadetId: async () => 'cadet' },
      { getConnection: async () => connection },
    );
    const res = response();
    await controller.uploadDocument(
      {
        user: { id: 'user', role: 'Cadet' },
        params: { id: 'doc' },
        file: {
          size: 10,
          mimetype: 'application/pdf',
          buffer: Buffer.from('pdf'),
        },
      },
      res,
    );
    assert.equal(res.statusCode, status === 'accepted' ? 409 : 500);
    assert.equal(updateCount, status === 'accepted' ? 0 : 1);
    assert.equal(committed, false);
    assert.equal(rolledBack, true);
  }
});

test('requested personal upload commits the file and revokes stale CTV approval together', async () => {
  const writes = [];
  let committed = false;
  const connection = {
    beginTransaction: async () => {},
    release() {},
    rollback: async () => {},
    commit: async () => {
      committed = true;
    },
    query: async (sql, params) => {
      if (sql.startsWith('SELECT'))
        return [[{ id: 'doc', status: 'reupload_requested' }]];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
  const controller = loadController(
    { resolveCadetId: async () => 'cadet' },
    { getConnection: async () => connection },
  );
  const res = response();
  const buffer = Buffer.from('test-pdf');
  await controller.uploadDocument(
    {
      user: { id: 'user', role: 'Cadet' },
      params: { id: 'doc' },
      file: {
        size: buffer.length,
        mimetype: 'application/pdf',
        originalname: 'passport.pdf',
        buffer,
      },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(committed, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].params[0], buffer);
  assert.match(writes[1].sql, /status='Revoked'/);
});
