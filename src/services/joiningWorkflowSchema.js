// Additive migration. Run only after the existing allocation tables exist.
const ensureJoiningWorkflow = async (db, addColumn) => {
  for (const [table, column, definition] of [
    ['allocations', 'follow_up_user_id', 'VARCHAR(36) NULL'],
    ['allocations', 'follow_up_assigned_by', 'VARCHAR(36) NULL'],
    ['allocations', 'follow_up_assigned_at', 'TIMESTAMP NULL'],
    ['allocations', 'primary_plan_version', 'INT NOT NULL DEFAULT 0'],
    ['allocations', 'secondary_plan_version', 'INT NOT NULL DEFAULT 0'],
    ['joining_plans', 'vessel_id', 'VARCHAR(36) NULL'],
    ['allocation_communications', 'recorded_by', 'VARCHAR(36) NULL'],
    ['allocation_communications', 'recorded_at', 'TIMESTAMP(3) NULL'],
    ['onboarding', 'admission_source', 'VARCHAR(20) NULL'],
    ['onboarding', 'admitted_at', 'TIMESTAMP NULL'],
  ])
    await addColumn(table, column, definition);
  const [ownerIndex] = await db.query(
    "SHOW INDEX FROM allocations WHERE Key_name='idx_allocations_follow_up_user'",
  );
  if (!ownerIndex.length)
    await db.query(
      'ALTER TABLE allocations ADD INDEX idx_allocations_follow_up_user (follow_up_user_id,is_active)',
    );

  await db.query(`CREATE TABLE IF NOT EXISTS allocation_workflow_history (
    id VARCHAR(36) PRIMARY KEY, allocation_id VARCHAR(36) NOT NULL,
    event_type VARCHAR(30) NOT NULL, vessel_role VARCHAR(10) NULL, revision INT NULL,
    previous_vessel_id VARCHAR(36) NULL, vessel_id VARCHAR(36) NULL,
    before_snapshot JSON NULL, after_snapshot JSON NULL, reason TEXT NULL,
    actor_id VARCHAR(36) NULL, actor_name VARCHAR(255) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_workflow_history_allocation (allocation_id,created_at),
    KEY idx_workflow_history_vessel (vessel_id), KEY idx_workflow_history_previous_vessel (previous_vessel_id),
    CONSTRAINT fk_workflow_history_allocation FOREIGN KEY (allocation_id) REFERENCES allocations(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS joining_email_attempts (
    id VARCHAR(36) PRIMARY KEY, request_key VARCHAR(100) NOT NULL UNIQUE,
    allocation_id VARCHAR(36) NOT NULL, joining_plan_id VARCHAR(36) NOT NULL,
    plan_revision INT NOT NULL, status VARCHAR(20) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL, cc JSON NOT NULL, subject VARCHAR(255) NOT NULL,
    html MEDIUMTEXT NOT NULL, snapshot JSON NOT NULL,
    informed_by VARCHAR(36) NOT NULL, recorded_by VARCHAR(36) NOT NULL, date_of_informing DATE NOT NULL,
    email_message_id VARCHAR(255) NULL, failure_reason TEXT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_joining_email_plan (joining_plan_id,created_at),
    CONSTRAINT fk_joining_email_allocation FOREIGN KEY (allocation_id) REFERENCES allocations(id) ON DELETE CASCADE,
    CONSTRAINT fk_joining_email_plan FOREIGN KEY (joining_plan_id) REFERENCES joining_plans(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS allocation_workflow_migrations (
    name VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [insert] = await connection.query(
      "INSERT IGNORE INTO allocation_workflow_migrations (name) VALUES ('joining-workflow-v1')",
    );
    if (insert.affectedRows) {
      await connection.query(`UPDATE onboarding o JOIN cadets c ON c.id=o.cadet_id
        SET o.admission_source='legacy'
        WHERE o.admission_source IS NULL AND (o.status='Onboarded' OR (o.status='Pending' AND c.status='CTV Assigned'))`);
      await connection.query(`UPDATE joining_plans jp JOIN allocations a ON a.id=jp.allocation_id
        LEFT JOIN vessels v ON v.id=CASE WHEN jp.vessel_role='Primary' THEN a.vessel_id ELSE a.secondary_vessel_id END
        SET jp.vessel_id=CASE WHEN jp.vessel_name=v.name THEN v.id ELSE NULL END`);
      await connection.query(`UPDATE allocations a
        LEFT JOIN joining_plans p ON p.allocation_id=a.id AND p.vessel_role='Primary'
        LEFT JOIN joining_plans s ON s.allocation_id=a.id AND s.vessel_role='Secondary'
        SET a.primary_plan_version=COALESCE(p.revision,0),a.secondary_plan_version=COALESCE(s.revision,0)`);
      await connection.query(`INSERT INTO allocation_workflow_history
        (id,allocation_id,event_type,vessel_role,revision,vessel_id,after_snapshot,reason)
        SELECT UUID(),a.id,'Imported',r.role,COALESCE(jp.revision,0),
          CASE WHEN r.role='Primary' THEN a.vessel_id ELSE a.secondary_vessel_id END,
          JSON_OBJECT('vessel_id',v.id,'vessel_name',COALESCE(v.name,jp.vessel_name),
            'saved_plan_vessel_name',jp.vessel_name,'vessel_role',r.role,
            'vessel_type',CASE WHEN jp.id IS NOT NULL THEN jp.vessel_type ELSE v.vessel_type END,
            'joining_date',CASE WHEN jp.id IS NOT NULL THEN jp.joining_date ELSE v.joining_date END,
            'reporting_port',CASE WHEN jp.id IS NOT NULL THEN jp.reporting_port ELSE v.reporting_port END,
            'location',CASE WHEN jp.id IS NOT NULL THEN jp.location ELSE v.location END,
            'voyage_ref',CASE WHEN jp.id IS NOT NULL THEN jp.voyage_ref ELSE v.voyage_ref END,
            'contact_person_name',CASE WHEN jp.id IS NOT NULL THEN jp.contact_person_name ELSE v.contact_person_name END,
            'contact_person_phone',CASE WHEN jp.id IS NOT NULL THEN jp.contact_person_phone ELSE v.contact_person_phone END,
            'contact_person_email',CASE WHEN jp.id IS NOT NULL THEN jp.contact_person_email ELSE v.contact_person_email END,
            'required_documents',jp.required_documents,'communication_details',jp.communication_details,
            'allocation_status',CASE WHEN r.role='Primary' THEN a.allocation_status ELSE a.secondary_allocation_status END),
          'Existing saved details; earlier history was not recorded'
        FROM allocations a CROSS JOIN (SELECT 'Primary' AS role UNION ALL SELECT 'Secondary') r
        LEFT JOIN joining_plans jp ON jp.allocation_id=a.id AND jp.vessel_role=r.role
        LEFT JOIN vessels v ON v.id=CASE WHEN r.role='Primary' THEN a.vessel_id ELSE a.secondary_vessel_id END
        WHERE v.id IS NOT NULL OR jp.id IS NOT NULL`);
    }
    await require('./joiningAllocationAdmissionMigration').migrateAllocationAdmissions(connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
module.exports = { ensureJoiningWorkflow };
