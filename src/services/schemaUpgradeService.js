const db = require("../config/database");
const { clearSchemaCache } = require("./schemaCompatibilityService");

const columnExists = async (tableName, columnName) => {
  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName],
  );

  return rows.length > 0;
};

const tableExists = async (tableName) => {
  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName],
  );

  return rows.length > 0;
};

const indexExists = async (tableName, indexName) => {
  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName],
  );

  return rows.length > 0;
};

const runSchemaChange = async (query, duplicateCodes = []) => {
  try {
    await db.query(query);
  } catch (error) {
    if (duplicateCodes.includes(error.code)) {
      return;
    }

    throw error;
  }
};

const ensureIndexIfColumns = async (tableName, indexName, columns = []) => {
  const hasTable = await tableExists(tableName);
  if (!hasTable) return;

  const columnChecks = await Promise.all(
    columns.map((columnName) => columnExists(tableName, columnName)),
  );
  if (columnChecks.some((exists) => !exists)) return;

  const hasIndex = await indexExists(tableName, indexName);
  if (hasIndex) return;

  await runSchemaChange(
    `ALTER TABLE ${tableName} ADD INDEX ${indexName} (${columns.join(", ")})`,
    ["ER_DUP_KEYNAME"],
  );
};

const ensurePerformanceIndexes = async () => {
  await Promise.all([
    ensureIndexIfColumns("cadets", "idx_cadets_drive_status_phase_created", [
      "drive_id",
      "status",
      "workflow_phase",
      "created_at",
    ]),
    ensureIndexIfColumns("recruitment_drives", "idx_rd_filters_created", [
      "institute_id",
      "status",
      "course_type",
      "year",
      "created_at",
    ]),
    ensureIndexIfColumns(
      "institute_submissions",
      "idx_isub_drive_context_created",
      ["drive_id", "institute_id", "batch_year", "course_type", "created_at"],
    ),
    ensureIndexIfColumns(
      "recruitment_communications",
      "idx_rc_drive_type_status",
      ["drive_id", "communication_type", "send_status"],
    ),
    ensureIndexIfColumns("assessments", "idx_assessments_cadet_status", [
      "cadet_id",
      "status",
    ]),
    ensureIndexIfColumns("interviews", "idx_interviews_cadet_decision", [
      "cadet_id",
      "final_decision",
    ]),
    ensureIndexIfColumns("cadet_documents", "idx_cadet_documents_cadet", [
      "cadet_id",
    ]),
  ]);
};

const ensureSubmissionDriveContext = async () => {
  const hasDriveId = await columnExists("institute_submissions", "drive_id");

  if (!hasDriveId) {
    await runSchemaChange(
      "ALTER TABLE institute_submissions ADD COLUMN drive_id VARCHAR(36) NULL AFTER course_type",
      ["ER_DUP_FIELDNAME"],
    );
    clearSchemaCache();
  }

  const hasDriveIdIndex = await indexExists(
    "institute_submissions",
    "idx_institute_submissions_drive_id",
  );

  if (!hasDriveIdIndex) {
    await runSchemaChange(
      "ALTER TABLE institute_submissions ADD INDEX idx_institute_submissions_drive_id (drive_id)",
      ["ER_DUP_KEYNAME"],
    );
  }

  const hasBatchYear = await columnExists(
    "institute_submissions",
    "batch_year",
  );
  const hasCourseType = await columnExists(
    "institute_submissions",
    "course_type",
  );

  if (!hasBatchYear || !hasCourseType) {
    return;
  }

  await db.query(
    `UPDATE institute_submissions isub
     JOIN recruitment_drives rd ON rd.id = isub.drive_id
     SET isub.drive_id = NULL
     WHERE isub.drive_id IS NOT NULL
       AND isub.created_at < rd.created_at`,
  );

  await db.query(
    `UPDATE institute_submissions isub
     JOIN (
       SELECT
         s.id AS submission_id,
         MIN(rd.id) AS drive_id,
         COUNT(rd.id) AS match_count
       FROM institute_submissions s
       JOIN recruitment_drives rd
         ON rd.institute_id = s.institute_id
        AND rd.year = s.batch_year
        AND rd.course_type = s.course_type
        AND s.created_at >= rd.created_at
       WHERE s.drive_id IS NULL
         AND s.batch_year IS NOT NULL
         AND s.course_type IS NOT NULL
       GROUP BY s.id
       HAVING COUNT(rd.id) = 1
     ) matches ON matches.submission_id = isub.id
     SET isub.drive_id = matches.drive_id
     WHERE isub.drive_id IS NULL`,
  );

  const hasCadets = await tableExists("cadets");
  const hasRecruitmentCommunications = await tableExists(
    "recruitment_communications",
  );
  const cadetEmptyCondition = hasCadets
    ? `AND NOT EXISTS (
       SELECT 1
       FROM cadets c
       WHERE c.drive_id = rd.id
     )`
    : "";
  const noRequestCondition = hasRecruitmentCommunications
    ? `AND NOT EXISTS (
       SELECT 1
       FROM recruitment_communications rc
       WHERE rc.drive_id = rd.id
         AND rc.communication_type = 'institute_request'
         AND LOWER(COALESCE(rc.send_status, 'sent')) = 'sent'
     )`
    : "";

  await db.query(
    `UPDATE recruitment_drives rd
     SET rd.status = 'Draft',
         rd.updated_at = CURRENT_TIMESTAMP
     WHERE rd.status = 'Received'
       ${noRequestCondition}
       ${cadetEmptyCondition}
       AND NOT EXISTS (
         SELECT 1
         FROM institute_submissions isub
         WHERE isub.drive_id = rd.id
            OR (
              isub.drive_id IS NULL
              AND isub.institute_id = rd.institute_id
              AND isub.batch_year = rd.year
              AND isub.course_type = rd.course_type
              AND isub.created_at >= rd.created_at
            )
       )`,
  );
};

const ensureMultipleInterviewersSupport = async () => {
  const hasTable = await tableExists("interviews");
  if (!hasTable) return;

  const hasInterviewers = await columnExists("interviews", "interviewers");
  if (!hasInterviewers) {
    await runSchemaChange(
      "ALTER TABLE interviews ADD COLUMN interviewers JSON NULL AFTER panel_members",
      ["ER_DUP_FIELDNAME"],
    );
    clearSchemaCache();
  }
};

const ensureEvaluationParametersSupport = async () => {
  const hasTable = await tableExists("interviews");
  if (!hasTable) return;

  const hasParams = await columnExists("interviews", "evaluation_parameters");
  if (!hasParams) {
    await runSchemaChange(
      "ALTER TABLE interviews ADD COLUMN evaluation_parameters JSON NULL AFTER interviewers",
      ["ER_DUP_FIELDNAME"],
    );
    clearSchemaCache();
  }
};

const ensureMedicalReportsSupport = async () => {
  const hasReportsTable = await tableExists("medical_reports");
  if (!hasReportsTable) {
    await runSchemaChange(
      `CREATE TABLE medical_reports (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      [],
    );
  }

  const hasReportsColumn = await columnExists(
    "medical_centers",
    "medical_reports",
  );
  if (!hasReportsColumn) {
    await runSchemaChange(
      "ALTER TABLE medical_centers ADD COLUMN medical_reports JSON NULL AFTER tests_offered",
      ["ER_DUP_FIELDNAME"],
    );
    clearSchemaCache();

    // Migrate existing tests_offered data
    const [centers] = await db.query(
      `SELECT id, tests_offered FROM medical_centers WHERE tests_offered IS NOT NULL AND tests_offered != ''`,
    );

    const { v4: uuidv4 } = require("uuid");

    for (const center of centers) {
      const tests = center.tests_offered
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const reportIds = [];

      for (const testName of tests) {
        const [existing] = await db.query(
          `SELECT id FROM medical_reports WHERE LOWER(name) = LOWER(?)`,
          [testName],
        );

        if (existing.length > 0) {
          reportIds.push(existing[0].id);
        } else {
          const reportId = uuidv4();
          await db.query(
            `INSERT INTO medical_reports (id, name, status) VALUES (?, ?, 'Active')`,
            [reportId, testName],
          );
          reportIds.push(reportId);
        }
      }

      if (reportIds.length > 0) {
        await db.query(
          `UPDATE medical_centers SET medical_reports = ? WHERE id = ?`,
          [JSON.stringify(reportIds), center.id],
        );
      }
    }
  }
};

const ensureMultipleMedicalAppointmentsSupport = async () => {
  const hasTable = await tableExists("cadet_medical_results");
  if (!hasTable) return;

  const hasAppointments = await columnExists("cadet_medical_results", "appointments");
  if (!hasAppointments) {
    await runSchemaChange(
      "ALTER TABLE cadet_medical_results ADD COLUMN appointments JSON NULL AFTER medical_center_id",
      ["ER_DUP_FIELDNAME"],
    );
    clearSchemaCache();
  }

  const hasReportResults = await columnExists("cadet_medical_results", "report_results");
  if (!hasReportResults) {
    await runSchemaChange(
      "ALTER TABLE cadet_medical_results ADD COLUMN report_results JSON NULL AFTER appointments",
      ["ER_DUP_FIELDNAME"],
    );
    clearSchemaCache();
  }
};

const ensureInstituteUploadFormatSupport = async () => {
  const hasInstitutes = await tableExists("institutes");
  if (hasInstitutes) {
    const hasInstituteUploadType = await columnExists(
      "institutes",
      "institute_upload_type",
    );
    if (!hasInstituteUploadType) {
      await runSchemaChange(
        "ALTER TABLE institutes ADD COLUMN institute_upload_type VARCHAR(20) NOT NULL DEFAULT 'Other' AFTER institute_type",
        ["ER_DUP_FIELDNAME"],
      );
      clearSchemaCache();
    }
  }

  const hasCadets = await tableExists("cadets");
  if (hasCadets) {
    const hasNationalIdNumber = await columnExists(
      "cadets",
      "national_id_number",
    );
    if (!hasNationalIdNumber) {
      await runSchemaChange(
        "ALTER TABLE cadets ADD COLUMN national_id_number VARCHAR(100) NULL AFTER gender",
        ["ER_DUP_FIELDNAME"],
      );
      clearSchemaCache();
    }
  }
};

module.exports = {
  ensureSubmissionDriveContext,
  ensurePerformanceIndexes,
  ensureInstituteUploadFormatSupport,
  ensureMultipleInterviewersSupport,
  ensureEvaluationParametersSupport,
  ensureMedicalReportsSupport,
  ensureMultipleMedicalAppointmentsSupport,
};
