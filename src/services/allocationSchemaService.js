const db = require('../config/database');
const { clearSchemaCache } = require('./schemaCompatibilityService');

const columnExists = async (table, column) => {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
};

const columnIsNullable = async (table, column) => {
  const [rows] = await db.query(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows[0]?.IS_NULLABLE === 'YES';
};

const indexExists = async (table, index) => {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index],
  );
  return rows.length > 0;
};

const constraintExists = async (table, constraint) => {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`,
    [table, constraint],
  );
  return rows.length > 0;
};

const addColumn = async (table, column, definition) => {
  if (!(await columnExists(table, column))) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    clearSchemaCache();
  }
};

const addIndex = async (table, index, definition) => {
  if (!(await indexExists(table, index))) {
    await db.query(`ALTER TABLE ${table} ADD ${definition}`);
  }
};

const addConstraint = async (table, name, definition) => {
  if (!(await constraintExists(table, name))) {
    await db.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
  }
};

const seedPermissions = async () => {
  await db.query(
    `INSERT INTO roles (id, name, display_name, description, is_system_role)
     SELECT UUID(), 'Admin', 'Administrator', 'Operational administrator for recruitment, allocation, and onboarding', 1
     WHERE NOT EXISTS (SELECT 1 FROM roles WHERE LOWER(name) = 'admin')`,
  );

  const permissions = [
    ['allocations', 'view', 'View CTV Allocations'],
    ['allocations', 'create', 'Create CTV Allocations'],
    ['allocations', 'edit', 'Edit CTV Allocations'],
    ['allocations', 'finalize', 'Finalize CTV Rank Lists'],
    ['allocations', 'communicate', 'Send Joining Intimations'],
    ['allocation-masters', 'view', 'View Allocation Masters'],
    ['allocation-masters', 'manage', 'Manage Allocation Masters'],
    ['onboarding', 'view', 'View Onboarding'],
    ['onboarding', 'edit', 'Update Onboarding'],
    ['vessel-master', 'view', 'View Vessel Master'],
    ['vessel-master', 'create', 'Create Vessels'],
    ['vessel-master', 'edit', 'Edit Vessels'],
    ['vessel-master', 'delete', 'Delete Vessels'],
  ];

  for (const [module, action, displayName] of permissions) {
    await db.query(
      `INSERT INTO permissions (id, module, action, display_name, description)
       SELECT UUID(), ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM permissions WHERE module = ? AND action = ?
       )`,
      [module, action, displayName, displayName, module, action],
    );
  }

  const adminActions = [
    ['allocations', 'view'],
    ['allocations', 'create'],
    ['allocations', 'edit'],
    ['allocations', 'finalize'],
    ['allocations', 'communicate'],
    ['allocation-masters', 'view'],
    ['allocation-masters', 'manage'],
    ['onboarding', 'view'],
    ['onboarding', 'edit'],
    ['vessel-master', 'view'],
    ['vessel-master', 'create'],
    ['vessel-master', 'edit'],
  ];

  for (const [module, action] of adminActions) {
    await db.query(
      `INSERT INTO role_permissions (id, role_id, permission_id, granted)
       SELECT UUID(), r.id, p.id, 1
       FROM roles r JOIN permissions p ON p.module = ? AND p.action = ?
       WHERE LOWER(r.name) = 'admin'
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions rp
           WHERE rp.role_id = r.id AND rp.permission_id = p.id
         )`,
      [module, action],
    );
  }
};

const ensureAllocationSupport = async () => {
  await db.query(`CREATE TABLE IF NOT EXISTS assessment_courses (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    department ENUM('Deck','Engine','Both') NOT NULL DEFAULT 'Both',
    default_max_score DECIMAL(10,2) NOT NULL DEFAULT 10,
    status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_assessment_courses_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await db.query(`UPDATE assessment_courses SET department='Both',default_max_score=10 WHERE department<>'Both' OR default_max_score<>10`);

  await db.query(`CREATE TABLE IF NOT EXISTS score_formula_templates (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    department ENUM('Deck','Engine') NOT NULL,
    version INT NOT NULL,
    academic_weight DECIMAL(6,3) NOT NULL,
    status ENUM('Draft','Active','Inactive') NOT NULL DEFAULT 'Draft',
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_formula_name_department_version (name, department, version),
    KEY idx_formula_department_status (department, status),
    CONSTRAINT fk_formula_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS score_formula_components (
    id VARCHAR(36) PRIMARY KEY,
    template_id VARCHAR(36) NOT NULL,
    course_id VARCHAR(36) NOT NULL,
    weight DECIMAL(6,3) NOT NULL,
    max_score DECIMAL(10,2) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_formula_course (template_id, course_id),
    CONSTRAINT fk_formula_component_template FOREIGN KEY (template_id) REFERENCES score_formula_templates(id) ON DELETE CASCADE,
    CONSTRAINT fk_formula_component_course FOREIGN KEY (course_id) REFERENCES assessment_courses(id) ON DELETE RESTRICT
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS vessel_types (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    department ENUM('Deck','Engine','Both') NOT NULL DEFAULT 'Both',
    status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_vessel_types_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  await addColumn('vessels', 'vessel_type_id', 'VARCHAR(36) NULL AFTER vessel_type');
  await addColumn('vessels', 'department', "ENUM('Deck','Engine','Both') NOT NULL DEFAULT 'Both' AFTER vessel_type_id");
  await addColumn('vessels', 'contact_person_name', 'VARCHAR(150) NULL');
  await addColumn('vessels', 'contact_person_email', 'VARCHAR(255) NULL');
  await addColumn('vessels', 'contact_person_phone', 'VARCHAR(50) NULL');
  await addColumn('vessels', 'required_documents', 'JSON NULL');
  await addIndex('vessels', 'idx_vessels_type_id', 'INDEX idx_vessels_type_id (vessel_type_id)');
  await addConstraint('vessels', 'fk_vessels_vessel_type', 'FOREIGN KEY (vessel_type_id) REFERENCES vessel_types(id) ON DELETE SET NULL');

  await db.query(`CREATE TABLE IF NOT EXISTS document_verifications (
    id VARCHAR(36) PRIMARY KEY,
    cadet_id VARCHAR(36) NOT NULL UNIQUE,
    status ENUM('Pending','Verified','Revoked') NOT NULL DEFAULT 'Pending',
    remarks TEXT NULL,
    verified_by VARCHAR(36) NULL,
    verified_at DATETIME NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_document_verification_cadet FOREIGN KEY (cadet_id) REFERENCES cadets(id) ON DELETE CASCADE,
    CONSTRAINT fk_document_verification_user FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS allocation_year_sequences (
    allocation_year INT PRIMARY KEY,
    last_number INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS allocation_cycles (
    id VARCHAR(36) PRIMARY KEY,
    allocation_number VARCHAR(30) NOT NULL UNIQUE,
    allocation_year INT NOT NULL,
    status ENUM('Active','Closed') NOT NULL DEFAULT 'Active',
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_allocation_cycles_year (allocation_year, created_at),
    CONSTRAINT fk_allocation_cycle_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS allocation_rank_lists (
    id VARCHAR(36) PRIMARY KEY,
    cycle_id VARCHAR(36) NOT NULL,
    department ENUM('Deck','Engine') NOT NULL,
    formula_template_id VARCHAR(36) NOT NULL,
    formula_snapshot JSON NOT NULL,
    status ENUM('Draft','Finalized') NOT NULL DEFAULT 'Draft',
    ranking_mode ENUM('Auto','Manual') NOT NULL DEFAULT 'Auto',
    finalized_by VARCHAR(36) NULL,
    finalized_at DATETIME NULL,
    unlocked_by VARCHAR(36) NULL,
    unlocked_at DATETIME NULL,
    unlock_remarks TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cycle_department (cycle_id, department),
    CONSTRAINT fk_rank_list_cycle FOREIGN KEY (cycle_id) REFERENCES allocation_cycles(id) ON DELETE CASCADE,
    CONSTRAINT fk_rank_list_formula FOREIGN KEY (formula_template_id) REFERENCES score_formula_templates(id) ON DELETE RESTRICT,
    CONSTRAINT fk_rank_list_finalized_user FOREIGN KEY (finalized_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_rank_list_unlocked_user FOREIGN KEY (unlocked_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  if (!(await columnIsNullable('allocation_rank_lists', 'formula_template_id'))) {
    await db.query('ALTER TABLE allocation_rank_lists MODIFY formula_template_id VARCHAR(36) NULL');
  }

  await addColumn('allocations', 'rank_list_id', 'VARCHAR(36) NULL AFTER id');
  await addColumn('allocations', 'academic_score', 'DECIMAL(10,2) NULL');
  await addColumn('allocations', 'final_score', 'DECIMAL(10,2) NULL');
  await addColumn('allocations', 'current_rank', 'INT NULL');
  await addColumn('allocations', 'vessel_type_id', 'VARCHAR(36) NULL');
  await addColumn('allocations', 'secondary_vessel_type_id', 'VARCHAR(36) NULL');
  await addColumn('allocations', 'secondary_vessel_id', 'VARCHAR(36) NULL');
  await addColumn('allocations', 'secondary_allocation_status', "ENUM('Pending','Allocated','Hold','Cancelled') NOT NULL DEFAULT 'Pending'");
  await addColumn('allocations', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
  await addColumn('allocations', 'added_by', 'VARCHAR(36) NULL');
  await addColumn('allocations', 'previous_cadet_status', 'VARCHAR(50) NULL');
  await addColumn('allocations', 'previous_workflow_phase', 'VARCHAR(50) NULL');
  await addColumn('allocations', 'previous_workflow_result', 'VARCHAR(50) NULL');
  await addIndex('allocations', 'idx_allocations_rank_list_active', 'INDEX idx_allocations_rank_list_active (rank_list_id, is_active, current_rank)');
  await addIndex('allocations', 'uq_allocations_rank_cadet', 'UNIQUE INDEX uq_allocations_rank_cadet (rank_list_id, cadet_id)');
  await addConstraint('allocations', 'fk_allocations_rank_list', 'FOREIGN KEY (rank_list_id) REFERENCES allocation_rank_lists(id) ON DELETE CASCADE');
  await addConstraint('allocations', 'fk_allocations_vessel_type', 'FOREIGN KEY (vessel_type_id) REFERENCES vessel_types(id) ON DELETE RESTRICT');
  await addConstraint('allocations', 'fk_allocations_secondary_vessel_type', 'FOREIGN KEY (secondary_vessel_type_id) REFERENCES vessel_types(id) ON DELETE RESTRICT');
  await addConstraint('allocations', 'fk_allocations_secondary_vessel', 'FOREIGN KEY (secondary_vessel_id) REFERENCES vessels(id) ON DELETE RESTRICT');
  await addConstraint('allocations', 'fk_allocations_added_user', 'FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL');

  await db.query(`CREATE TABLE IF NOT EXISTS allocation_score_entries (
    id VARCHAR(36) PRIMARY KEY,
    allocation_id VARCHAR(36) NOT NULL,
    course_id VARCHAR(36) NOT NULL,
    course_name_snapshot VARCHAR(150) NOT NULL,
    max_score_snapshot DECIMAL(10,2) NOT NULL,
    weight_snapshot DECIMAL(6,3) NOT NULL,
    score DECIMAL(10,2) NULL,
    updated_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_allocation_score_course (allocation_id, course_id),
    CONSTRAINT fk_allocation_score_allocation FOREIGN KEY (allocation_id) REFERENCES allocations(id) ON DELETE CASCADE,
    CONSTRAINT fk_allocation_score_course FOREIGN KEY (course_id) REFERENCES assessment_courses(id) ON DELETE RESTRICT,
    CONSTRAINT fk_allocation_score_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  await db.query(
    `UPDATE allocation_score_entries ase
     JOIN allocations a ON a.id=ase.allocation_id
     JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
     SET ase.max_score_snapshot=10
     WHERE rl.status='Draft' AND ase.max_score_snapshot<>10`,
  );
  const [draftSnapshots] = await db.query(`SELECT id,formula_snapshot FROM allocation_rank_lists WHERE status='Draft'`);
  for (const row of draftSnapshots) {
    let snapshot = row.formula_snapshot;
    if (typeof snapshot === 'string') {
      try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; }
    }
    if (!snapshot || !Array.isArray(snapshot.components)) continue;
    snapshot.scoring_method = 'SimpleTotal';
    snapshot.components = snapshot.components.map((component) => ({ ...component, max_score: 10, weight: 0 }));
    await db.query(`UPDATE allocation_rank_lists SET formula_snapshot=? WHERE id=?`, [JSON.stringify(snapshot), row.id]);
  }

  await db.query(`CREATE TABLE IF NOT EXISTS allocation_rank_history (
    id VARCHAR(36) PRIMARY KEY,
    rank_list_id VARCHAR(36) NOT NULL,
    allocation_id VARCHAR(36) NULL,
    action ENUM('MoveUp','MoveDown','Reset','Finalize','Unlock') NOT NULL,
    from_rank INT NULL,
    to_rank INT NULL,
    remarks TEXT NOT NULL,
    changed_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_rank_history_list_created (rank_list_id, created_at),
    CONSTRAINT fk_rank_history_list FOREIGN KEY (rank_list_id) REFERENCES allocation_rank_lists(id) ON DELETE CASCADE,
    CONSTRAINT fk_rank_history_allocation FOREIGN KEY (allocation_id) REFERENCES allocations(id) ON DELETE SET NULL,
    CONSTRAINT fk_rank_history_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS joining_plans (
    id VARCHAR(36) PRIMARY KEY,
    allocation_id VARCHAR(36) NOT NULL UNIQUE,
    vessel_role ENUM('Primary','Secondary') NOT NULL DEFAULT 'Primary',
    status VARCHAR(30) NOT NULL DEFAULT 'Draft',
    vessel_name VARCHAR(255) NOT NULL,
    vessel_type VARCHAR(100) NULL,
    location VARCHAR(255) NULL,
    joining_date DATE NULL,
    total_seats INT NULL,
    voyage_ref VARCHAR(100) NULL,
    reporting_port VARCHAR(255) NULL,
    contact_person_name VARCHAR(150) NULL,
    contact_person_email VARCHAR(255) NULL,
    contact_person_phone VARCHAR(50) NULL,
    communication_details TEXT NULL,
    required_documents JSON NULL,
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_joining_plan_allocation FOREIGN KEY (allocation_id) REFERENCES allocations(id) ON DELETE CASCADE,
    CONSTRAINT fk_joining_plan_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  await addColumn('joining_plans', 'vessel_role', "ENUM('Primary','Secondary') NOT NULL DEFAULT 'Primary' AFTER allocation_id");
  await addIndex('joining_plans', 'uq_joining_plan_allocation_role', 'UNIQUE INDEX uq_joining_plan_allocation_role (allocation_id, vessel_role)');
  const [singleAllocationIndexes] = await db.query(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='joining_plans' AND NON_UNIQUE=0
     GROUP BY INDEX_NAME
     HAVING COUNT(*)=1 AND MAX(COLUMN_NAME)='allocation_id'`,
  );
  for (const row of singleAllocationIndexes) {
    await db.query(`ALTER TABLE joining_plans DROP INDEX \`${String(row.INDEX_NAME).replace(/`/g, '``')}\``);
  }

  await db.query(`CREATE TABLE IF NOT EXISTS allocation_communications (
    id VARCHAR(36) PRIMARY KEY,
    joining_plan_id VARCHAR(36) NOT NULL,
    informed_by VARCHAR(36) NULL,
    date_of_informing DATE NOT NULL,
    informed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    mode ENUM('Email','Phone','WhatsApp') NOT NULL,
    confirmation_received TINYINT(1) NOT NULL DEFAULT 0,
    candidate_remarks TEXT NULL,
    admin_remarks TEXT NULL,
    delivery_status ENUM('Sent','Failed') NULL,
    email_message_id VARCHAR(255) NULL,
    failure_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_allocation_communications_plan (joining_plan_id, created_at),
    CONSTRAINT fk_allocation_communication_plan FOREIGN KEY (joining_plan_id) REFERENCES joining_plans(id) ON DELETE CASCADE,
    CONSTRAINT fk_allocation_communication_user FOREIGN KEY (informed_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  await addColumn('onboarding', 'allocation_id', 'VARCHAR(36) NULL AFTER cadet_id');
  await addColumn('onboarding', 'updated_by', 'VARCHAR(36) NULL');
  await addColumn('onboarding', 'completed_by', 'VARCHAR(36) NULL');
  await addColumn('onboarding', 'completed_at', 'DATETIME NULL');
  await addIndex('onboarding', 'uq_onboarding_allocation', 'UNIQUE INDEX uq_onboarding_allocation (allocation_id)');
  await addConstraint('onboarding', 'fk_onboarding_allocation', 'FOREIGN KEY (allocation_id) REFERENCES allocations(id) ON DELETE CASCADE');
  await addConstraint('onboarding', 'fk_onboarding_updated_user', 'FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL');
  await addConstraint('onboarding', 'fk_onboarding_completed_user', 'FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL');

  await seedPermissions();
};

module.exports = { ensureAllocationSupport };
