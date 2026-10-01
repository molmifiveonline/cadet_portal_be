const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'),
    {
      module,
      console: { error() {} },
      Date,
      require(name) {
        if (name in mocks) return mocks[name];
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  return module.exports;
}
const response = () => ({
  code: 200,
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

function controllerSetup() {
  const writes = [],
    logs = [];
  let role = { id: 'role', name: 'Recruiter', display_name: 'Recruiter' },
    clears = 0;
  const dao = {
    getRoleById: async () => role,
    getAllPermissions: async () => [{ id: 'view' }, { id: 'edit' }],
    updateRolePermissions: async (...args) => writes.push(args),
    setRolePermission: async (...args) => {
      writes.push(args);
      return true;
    },
    getRolePermissionsByModule: async () => [],
  };
  const controller = load('controllers/rolePermissionController.js', {
    '../dao/rolePermissionDao': dao,
    '../dao/activityLogDao': { createLog: async (...args) => logs.push(args) },
    '../middleware/permissionMiddleware': {
      clearPermissionCache: () => clears++,
    },
    '../config/constants': { ROLES: { SUPER_ADMIN: 'SuperAdmin' } },
  });
  return {
    dao,
    writes,
    logs,
    setRole: (value) => (role = value),
    clears: () => clears,
    async invoke(handler, body = {}) {
      const res = response();
      await controller[handler](
        {
          params: { roleId: 'role' },
          body,
          user: { id: 'admin' },
          ip: 'local',
        },
        res,
      );
      return res;
    },
  };
}

for (const permissions of [
  null,
  [{ permissionId: 'view', granted: 'false' }],
  [{ permissionId: 'unknown', granted: true }],
  [
    { permissionId: 'view', granted: true },
    { permissionId: 'view', granted: false },
  ],
]) {
  test(`rejects invalid permission changes ${JSON.stringify(permissions)}`, async () => {
    const harness = controllerSetup();
    const res = await harness.invoke('updateRolePermissions', { permissions });
    assert.equal(res.code, 400);
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.clears(), 0);
  });
}

test('bulk and single permission endpoints protect fixed system roles', async () => {
  for (const name of ['SuperAdmin', 'Institute', 'Cadet']) {
    const harness = controllerSetup();
    harness.setRole({ id: 'role', name });
    assert.equal(
      (
        await harness.invoke('updateRolePermissions', {
          permissions: [{ permissionId: 'view', granted: true }],
        })
      ).code,
      403,
    );
    assert.equal(
      (
        await harness.invoke('setRolePermission', {
          permissionId: 'view',
          granted: true,
        })
      ).code,
      403,
    );
    assert.equal(harness.writes.length, 0);
  }
});

test('valid changes save, clear authorization cache and create an activity record', async () => {
  const harness = controllerSetup();
  assert.equal(
    (
      await harness.invoke('updateRolePermissions', {
        permissions: [{ permissionId: 'view', granted: false }],
      })
    ).code,
    200,
  );
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.clears(), 1);
  assert.equal(harness.logs[0][1], 'PERMISSION_UPDATE');
});

test('a nonexistent role cannot load or save permissions', async () => {
  const harness = controllerSetup();
  harness.setRole(null);
  assert.equal((await harness.invoke('getRolePermissions')).code, 404);
  assert.equal(
    (await harness.invoke('updateRolePermissions', { permissions: [] })).code,
    404,
  );
});

test('deleting an assigned role returns a conflict without a deletion log or cache reset', async () => {
  const harness = controllerSetup();
  harness.dao.deleteRole = async () => {
    throw Object.assign(
      new Error('Assign users to another role before deleting this role'),
      { status: 409 },
    );
  };
  const res = await harness.invoke('deleteRole');
  assert.equal(res.code, 409);
  assert.equal(res.body.success, false);
  assert.equal(
    res.body.message,
    'Assign users to another role before deleting this role',
  );
  assert.equal(harness.logs.length, 0);
  assert.equal(harness.clears(), 0);
});

function daoSetup({ failWrite = false, assigned = false } = {}) {
  const events = [];
  const state = new Map([['view', true]]);
  let before;
  const connection = {
    async beginTransaction() {
      events.push('begin');
      before = new Map(state);
    },
    async commit() {
      events.push('commit');
    },
    async rollback() {
      events.push('rollback');
      state.clear();
      for (const item of before) state.set(...item);
    },
    release() {
      events.push('release');
    },
    async query(sql, params) {
      if (sql.startsWith('SELECT id FROM roles')) return [[{ id: 'role' }]];
      if (sql.startsWith('SELECT name, is_system_role'))
        return [[{ name: 'Recruiter', is_system_role: 0 }]];
      if (sql.startsWith('SELECT id FROM users'))
        return [assigned ? [{ id: 'user' }] : []];
      if (sql.startsWith('SELECT id FROM role_permissions'))
        return [state.has(params[1]) ? [{ id: 'grant' }] : []];
      if (sql.startsWith('UPDATE role_permissions')) {
        state.set(params[2], params[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO role_permissions')) {
        if (failWrite) throw new Error('write failed');
        state.set(params[2], params[3]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM role_permissions')) {
        state.clear();
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM roles')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const dao = load('dao/rolePermissionDao.js', {
    '../config/database': { getConnection: async () => connection },
    uuid: { v4: () => 'grant' },
    '../services/rolePermissionCatalog': {
      ensureRolePermissionCatalog: async () => {},
    },
  });
  return { dao, state, events };
}

test('a failed bulk update rolls back earlier grants and releases the connection', async () => {
  const { dao, state, events } = daoSetup({ failWrite: true });
  await assert.rejects(
    dao.updateRolePermissions('role', [
      { permissionId: 'view', granted: false },
      { permissionId: 'edit', granted: true },
    ]),
    /write failed/,
  );
  assert.equal(state.get('view'), true);
  assert.equal(state.has('edit'), false);
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});

test('all successful changes commit together', async () => {
  const { dao, state, events } = daoSetup();
  await dao.updateRolePermissions('role', [
    { permissionId: 'view', granted: false },
    { permissionId: 'edit', granted: true },
  ]);
  assert.equal(state.get('view'), false);
  assert.equal(state.get('edit'), true);
  assert.deepEqual(events, ['begin', 'commit', 'release']);
});

test('deleting a role assigned to users preserves its grants', async () => {
  const { dao, state, events } = daoSetup({ assigned: true });
  await assert.rejects(dao.deleteRole('role'), (error) => error.status === 409);
  assert.equal(state.get('view'), true);
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});

test('legacy drive delete grants are omitted from permission lists and cannot authorize access', async () => {
  const active = ['create', 'edit', 'view'].map((action) => ({
    id: `drive-${action}`,
    module: 'recruitment_drives',
    action,
    granted: 1,
  }));
  active.push({
    id: 'vessel-delete',
    module: 'vessel-master',
    action: 'delete',
    granted: 1,
  });
  const saved = [
    ...active,
    {
      id: 'drive-delete',
      module: 'recruitment_drives',
      action: 'delete',
      granted: 1,
    },
  ];
  const queries = [];
  const dao = load('dao/rolePermissionDao.js', {
    '../config/database': {
      query: async (sql) => {
        queries.push(sql);
        return [saved];
      },
    },
    uuid: { v4: () => 'grant' },
    '../services/rolePermissionCatalog': {
      ensureRolePermissionCatalog: async () => {},
    },
  });
  for (const rows of [
    await dao.getAllPermissions(),
    await dao.getRolePermissions('role'),
    await dao.getPermissionsByRoleName('Recruiter'),
  ]) {
    assert.deepEqual(
      Array.from(rows, (row) => row.id),
      active.map((row) => row.id),
    );
  }
  const grouped = await dao.getRolePermissionsByModule('role');
  assert.deepEqual(
    Array.from(
      grouped.find((group) => group.module === 'recruitment_drives')
        .permissions,
      (row) => row.action,
    ),
    ['create', 'edit', 'view'],
  );
  const readCount = queries.length;
  assert.equal(
    await dao.hasPermission('role', 'recruitment_drives', 'delete'),
    false,
  );
  assert.equal(
    await dao.userHasPermission('Recruiter', 'recruitment_drives', 'delete'),
    false,
  );
  assert.equal(queries.length, readCount);
  assert.equal(
    await dao.userHasPermission('Recruiter', 'vessel-master', 'delete'),
    true,
  );
  assert.equal(saved.length, 5);
  assert.ok(queries.every((sql) => sql.startsWith('SELECT')));
});

test('catalog synchronization adds medical actions without changing role grants', async () => {
  const queries = [];
  const catalog = load('services/rolePermissionCatalog.js', {
    '../config/database': {
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release() {},
        query: async (...args) => {
          queries.push(args);
          return [{ affectedRows: 0 }];
        },
      }),
    },
  });
  await Promise.all([
    catalog.ensureRolePermissionCatalog(),
    catalog.ensureRolePermissionCatalog(),
  ]);
  const count = queries.length;
  await catalog.ensureRolePermissionCatalog();
  assert.equal(queries.length, count);
  for (const action of ['view', 'create', 'edit', 'delete']) {
    assert.ok(
      queries.some(
        ([sql, values]) =>
          sql.startsWith('INSERT') &&
          values[0] === 'medical-centers' &&
          values[1] === action,
      ),
    );
  }
  assert.ok(queries.every(([sql]) => !sql.includes('role_permissions')));
  assert.deepEqual(
    Array.from(catalog.permissionCatalog)
      .filter(([module]) => module === 'recruitment_drives')
      .map(([, action]) => action),
    ['view', 'create', 'edit'],
  );
  assert.ok(
    queries.some(([, values]) =>
      values.includes('Record Candidate Communication'),
    ),
  );
});

test('cache invalidation prevents an in-flight old grant from restoring revoked access', async () => {
  let resolve,
    reads = 0;
  const pending = new Promise((done) => (resolve = done));
  const middleware = load('middleware/permissionMiddleware.js', {
    '../dao/rolePermissionDao': {
      userHasPermission: async () => (++reads === 1 ? pending : false),
    },
    '../config/constants': { ROLES: { SUPER_ADMIN: 'SuperAdmin' } },
  });
  let next = false;
  const res = response();
  const request = middleware.requirePermission('allocations', 'edit')(
    { user: { role: 'Recruiter' } },
    res,
    () => (next = true),
  );
  middleware.clearPermissionCache();
  resolve(true);
  await request;
  assert.equal(next, false);
  assert.equal(res.code, 403);
  assert.equal(reads, 2);
});

test('allocation lookup access does not grant master writes or communication access', async () => {
  const routes = [];
  const router = Object.fromEntries(
    ['get', 'post', 'put', 'delete', 'use'].map((method) => [
      method,
      (...args) => routes.push({ method, args }),
    ]),
  );
  const middleware = load('middleware/permissionMiddleware.js', {
    '../dao/rolePermissionDao': {
      userHasPermission: async (role, module, action) =>
        module === 'allocations' && action === 'view',
    },
    '../config/constants': { ROLES: { SUPER_ADMIN: 'SuperAdmin' } },
  });
  load('routes/allocationRoutes.js', {
    express: { Router: () => router },
    '../middleware/authMiddleware': { authMiddleware() {} },
    '../middleware/permissionMiddleware': middleware,
    '../controllers/allocationController': {},
    '../controllers/allocationMasterController': {},
    '../controllers/vesselController': {},
  });
  for (const [method, url, allowed] of [
    ['get', '/masters/courses', true],
    ['get', '/masters/vessel-types', true],
    ['get', '/vessels', true],
    ['post', '/masters/courses', false],
    ['get', '/admins', false],
    ['post', '/joining-plans/:joiningPlanId/communications', false],
    ['post', '/candidate-allocations/:allocationId/joining-plan', false],
  ]) {
    const guard = routes.find(
      (route) => route.method === method && route.args[0] === url,
    ).args[1];
    let passed = false;
    const res = response();
    await guard({ user: { role: 'Viewer' } }, res, () => (passed = true));
    assert.equal(passed, allowed, `${method} ${url}`);
    if (!allowed) assert.equal(res.code, 403);
  }
});
