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
      Date,
      console,
      require(name) {
        if (name in mocks) return mocks[name];
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  return module.exports;
}

const createId = 'allocation-masters:create';
const manageId = 'allocation-masters:manage';

function catalogSetup() {
  const state = {
    permissions: new Map([[manageId, 'Manage Assessment Courses']]),
    grants: new Map([
      [`manager|${manageId}`, true],
      [`viewer|${manageId}`, false],
    ]),
    failMigration: false,
  };
  const events = [];
  const db = {
    async getConnection() {
      let snapshot;
      return {
        async beginTransaction() {
          events.push('begin');
          snapshot = {
            permissions: new Map(state.permissions),
            grants: new Map(state.grants),
          };
        },
        async commit() {
          events.push('commit');
        },
        async rollback() {
          events.push('rollback');
          Object.assign(state, snapshot);
        },
        release() {
          events.push('release');
        },
        async query(sql, values) {
          if (sql.startsWith('INSERT INTO permissions')) {
            const id = `${values[0]}:${values[1]}`;
            if (state.permissions.has(id)) return [{ affectedRows: 0 }];
            state.permissions.set(id, values[2]);
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('UPDATE permissions')) {
            state.permissions.set(`${values[2]}:${values[3]}`, values[0]);
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('SELECT id FROM permissions'))
            return [[{ id: `${values[0]}:${values[1]}` }]];
          if (sql.startsWith('SELECT rp.role_id'))
            return [
              [...state.grants]
                .filter(
                  ([key, granted]) => key.endsWith(`|${manageId}`) && granted,
                )
                .map(([key]) => ({ role_id: key.split('|')[0] })),
            ];
          if (sql.startsWith('INSERT INTO role_permissions')) {
            if (state.failMigration) throw new Error('migration write failed');
            state.grants.set(`${values[0]}|${values[1]}`, true);
            return [{ affectedRows: 1 }];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  return {
    state,
    events,
    freshCatalog: () =>
      load('services/rolePermissionCatalog.js', { '../config/database': db }),
  };
}

test('splitting Add Assessment preserves existing creation access without granting it to viewers', async () => {
  const { state, events, freshCatalog } = catalogSetup();
  const catalog = freshCatalog();
  await Promise.all([
    catalog.ensureRolePermissionCatalog(),
    catalog.ensureRolePermissionCatalog(),
  ]);
  assert.equal(state.permissions.get(createId), 'Add Assessment');
  assert.equal(state.permissions.get(manageId), 'Edit and Delete Assessments');
  assert.equal(state.grants.get(`manager|${createId}`), true);
  assert.equal(state.grants.has(`viewer|${createId}`), false);
  assert.equal(state.grants.get(`manager|${manageId}`), true);
  assert.equal(state.grants.get(`viewer|${manageId}`), false);
  assert.deepEqual(events, ['begin', 'commit', 'release']);
});

test('catalog synchronization never restores Add Assessment after an explicit revocation', async () => {
  const { state, freshCatalog } = catalogSetup();
  await freshCatalog().ensureRolePermissionCatalog();
  state.grants.set(`manager|${createId}`, false);
  state.grants.set(`new-manager|${manageId}`, true);
  await freshCatalog().ensureRolePermissionCatalog();
  assert.equal(state.grants.get(`manager|${createId}`), false);
  assert.equal(state.grants.has(`new-manager|${createId}`), false);
});

test('a failed migration rolls back the new permission and can be retried safely', async () => {
  const { state, events, freshCatalog } = catalogSetup();
  const catalog = freshCatalog();
  state.failMigration = true;
  await assert.rejects(
    catalog.ensureRolePermissionCatalog(),
    /migration write failed/,
  );
  assert.equal(state.permissions.has(createId), false);
  assert.equal(state.grants.has(`manager|${createId}`), false);
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
  state.failMigration = false;
  await catalog.ensureRolePermissionCatalog();
  assert.equal(state.grants.get(`manager|${createId}`), true);
});

test('assessment routes enforce creation independently from edit and delete', async () => {
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
        module === 'allocation-masters' &&
        ((role === 'Creator' && action === 'create') ||
          (role === 'Editor' && action === 'manage')),
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
  for (const [role, createAllowed, editAllowed] of [
    ['Creator', true, false],
    ['Editor', false, true],
    ['Viewer', false, false],
    ['SuperAdmin', true, true],
  ]) {
    for (const [method, url, allowed] of [
      ['post', '/masters/courses', createAllowed],
      ['put', '/masters/courses/:id', editAllowed],
      ['delete', '/masters/courses/:id', editAllowed],
    ]) {
      const guard = routes.find(
        (route) => route.method === method && route.args[0] === url,
      ).args[1];
      let passed = false;
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
      await guard({ user: { role } }, res, () => (passed = true));
      assert.equal(passed, allowed, `${role}: ${method} ${url}`);
      if (!allowed) assert.equal(res.code, 403);
    }
  }
});
