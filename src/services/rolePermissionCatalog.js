const db = require('../config/database');

// Only actions enforced by active routes belong in this catalog. New actions
// start denied, except when splitting an existing grant to preserve its access.
const permissionCatalog = [
  ['dashboard', 'view', 'View Dashboard'],
  ...['view', 'create', 'edit', 'delete'].flatMap((action) => [
    ['users', action, `${action} System Users`],
    ['institutes', action, `${action} Institutes`],
    ['cadets', action, `${action} Cadets`],
    ['vessel-master', action, `${action} Vessels`],
    [
      'medical-centers',
      action,
      `${action} Medical Centers and Report Templates`,
    ],
  ]),
  ...['view', 'create', 'edit'].map((action) => [
    'recruitment_drives',
    action,
    `${action} Recruitment Drives`,
  ]),
  ['medical', 'view', 'View Medical & Documents'],
  ['submit-excel', 'view', 'View Excel Submissions'],
  ['activity-logs', 'view', 'View Activity Logs'],
  [
    'role-permissions',
    'manage',
    'Manage Roles and Permissions',
    'Create roles and grant or revoke access to portal features.',
  ],
  ['allocations', 'view', 'View Vessel Allocations'],
  ['allocations', 'create', 'Create Vessel Allocations'],
  [
    'allocations',
    'edit',
    'Edit Allocations and Joining Plans',
    'Manage candidates, scores, ranks, vessel assignments and joining plans.',
  ],
  ['allocations', 'finalize', 'Finalize Rank Lists'],
  [
    'allocations',
    'communicate',
    'Record Candidate Communication',
    'Record contact and confirmation received by email, phone or WhatsApp. This does not send a message.',
  ],
  ['allocation-masters', 'view', 'View Assessment Masters'],
  ['allocation-masters', 'create', 'Add Assessment'],
  [
    'allocation-masters',
    'manage',
    'Edit and Delete Assessments',
    'Edit, activate, deactivate and delete assessments. Formula changes remain restricted to SuperAdmin.',
  ],
  ['onboarding', 'view', 'View Onboarding'],
  ['onboarding', 'edit', 'Update Onboarding'],
];

let synchronization;
const ensureRolePermissionCatalog = () => {
  if (!synchronization) {
    synchronization = (async () => {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        for (const [module, action, label, description] of permissionCatalog) {
          const displayName = label.charAt(0).toUpperCase() + label.slice(1);
          const [result] = await connection.query(
            `INSERT INTO permissions (id, module, action, display_name, description)
           SELECT UUID(), ?, ?, ?, ? WHERE NOT EXISTS (
             SELECT 1 FROM permissions WHERE module = ? AND action = ?
           )`,
            [
              module,
              action,
              displayName,
              description || displayName,
              module,
              action,
            ],
          );
          if (
            module === 'allocation-masters' &&
            action === 'create' &&
            result.affectedRows > 0
          ) {
            // Run once, only when introducing the new action. Later revocations
            // must stay revoked, even if the role still has manage permission.
            const [[permission]] = await connection.query(
              'SELECT id FROM permissions WHERE module = ? AND action = ?',
              [module, action],
            );
            const [managers] = await connection.query(
              `SELECT rp.role_id FROM role_permissions rp
             JOIN permissions p ON p.id = rp.permission_id
             WHERE p.module = ? AND p.action = 'manage' AND rp.granted = 1`,
              [module],
            );
            for (const { role_id } of managers) {
              await connection.query(
                'INSERT INTO role_permissions (id, role_id, permission_id, granted) VALUES (UUID(), ?, ?, 1)',
                [role_id, permission.id],
              );
            }
          }
          await connection.query(
            'UPDATE permissions SET display_name = ?, description = ? WHERE module = ? AND action = ?',
            [displayName, description || displayName, module, action],
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    })().catch((error) => {
      synchronization = null;
      throw error;
    });
  }
  return synchronization;
};

module.exports = { permissionCatalog, ensureRolePermissionCatalog };
