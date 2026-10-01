const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID, randomBytes } = require('node:crypto');

test(
  'role CRUD and permission transactions against isolated MySQL tables',
  { skip: process.env.ROLE_PERMISSION_DB_TESTS !== '1' },
  async () => {
    const db = require('../src/config/database');
    const connection = await db.getConnection();
    const suffix = randomBytes(6).toString('hex');
    const tables = ['roles', 'permissions', 'role_permissions', 'users'];
    const names = Object.fromEntries(
      tables.map((table) => [table, `permission_test_${suffix}_${table}`]),
    );
    let failPermission;
    const query = async (sql, params) => {
      if (
        sql.startsWith('INSERT INTO role_permissions') &&
        params[2] === failPermission
      )
        throw new Error('simulated write failure');
      return connection.query(
        sql.replace(
          /\b(roles|permissions|role_permissions|users)\b/g,
          (table) => names[table],
        ),
        params,
      );
    };
    try {
      for (const table of tables)
        await connection.query(
          `CREATE TEMPORARY TABLE ${names[table]} LIKE ${table}`,
        );
      const module = { exports: {} };
      vm.runInNewContext(
        fs.readFileSync(
          path.join(__dirname, '../src/dao/rolePermissionDao.js'),
          'utf8',
        ),
        {
          module,
          require(name) {
            if (name === 'uuid') return { v4: randomUUID };
            if (name === '../services/rolePermissionCatalog')
              return { ensureRolePermissionCatalog: async () => {} };
            if (name === '../config/database')
              return {
                query,
                getConnection: async () => ({
                  query,
                  beginTransaction: () => connection.beginTransaction(),
                  commit: () => connection.commit(),
                  rollback: () => connection.rollback(),
                  release() {},
                }),
              };
            throw new Error(`Unexpected import ${name}`);
          },
        },
      );
      const dao = module.exports;
      const role = await dao.createRole({
        name: 'Permission_Test',
        display_name: 'Permission Test',
        description: '',
      });
      assert.ok(role.id);
      assert.equal(Number((await dao.getAllRoles())[0].assigned_user_count), 0);
      assert.equal(
        await dao.updateRole(role.id, {
          display_name: 'Updated Name',
          description: 'Updated description',
        }),
        true,
      );
      assert.equal(
        (await dao.getRoleById(role.id)).display_name,
        'Updated Name',
      );
      const view = randomUUID(),
        edit = randomUUID();
      for (const [id, action] of [
        [view, 'view'],
        [edit, 'edit'],
      ]) {
        await query(
          'INSERT INTO permissions (id, module, action, display_name) VALUES (?, ?, ?, ?)',
          [id, 'allocations', action, action],
        );
      }
      assert.equal(
        await dao.userHasPermission(role.name, 'allocations', 'view'),
        false,
      );
      await dao.setRolePermission(role.id, view, true);
      assert.equal(
        await dao.userHasPermission(role.name, 'allocations', 'view'),
        true,
      );
      failPermission = edit;
      await assert.rejects(
        dao.updateRolePermissions(role.id, [
          { permissionId: view, granted: false },
          { permissionId: edit, granted: true },
        ]),
        /simulated write failure/,
      );
      assert.equal(
        await dao.userHasPermission(role.name, 'allocations', 'view'),
        true,
      );
      assert.equal(
        await dao.userHasPermission(role.name, 'allocations', 'edit'),
        false,
      );
      failPermission = null;
      await dao.updateRolePermissions(role.id, [
        { permissionId: view, granted: false },
        { permissionId: edit, granted: true },
      ]);
      assert.equal(
        await dao.userHasPermission(role.name, 'allocations', 'view'),
        false,
      );
      assert.equal(
        await dao.userHasPermission(role.name, 'allocations', 'edit'),
        true,
      );
      for (const status of ['active', 'inactive']) {
        await query(
          'INSERT INTO users (id, email, password, role, status) VALUES (?, ?, ?, ?, ?)',
          [
            randomUUID(),
            `permission-test-${status}@example.test`,
            'unused',
            role.name.toLowerCase(),
            status,
          ],
        );
      }
      assert.equal(Number((await dao.getAllRoles())[0].assigned_user_count), 2);
      await assert.rejects(
        dao.deleteRole(role.id),
        (error) => error.status === 409,
      );
      // Even an inactive user still owns its assigned role.
      await query("UPDATE users SET role = 'Viewer' WHERE status = 'active'");
      assert.equal(Number((await dao.getAllRoles())[0].assigned_user_count), 1);
      await assert.rejects(
        dao.deleteRole(role.id),
        (error) => error.status === 409,
      );
      assert.equal(
        await dao.userHasPermission(role.name, 'allocations', 'edit'),
        true,
      );
      await query("UPDATE users SET role = 'Viewer' WHERE status = 'inactive'");
      assert.equal(Number((await dao.getAllRoles())[0].assigned_user_count), 0);
      assert.equal(await dao.deleteRole(role.id), true);
      assert.equal(await dao.getRoleById(role.id), undefined);
    } finally {
      await connection.rollback();
      for (const table of tables.reverse())
        await connection.query(
          `DROP TEMPORARY TABLE IF EXISTS ${names[table]}`,
        );
      connection.release();
      await db.end();
    }
  },
);
