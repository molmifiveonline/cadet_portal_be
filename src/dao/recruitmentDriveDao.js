const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { hasColumn, hasTable } = require('../services/schemaCompatibilityService');

const getCadetCompatibility = async () => ({
  hasWorkflowPhase: await hasColumn('cadets', 'workflow_phase'),
});

const getSubmissionCompatibility = async () => ({
  hasBatchYear: await hasColumn('institute_submissions', 'batch_year'),
  hasCourseType: await hasColumn('institute_submissions', 'course_type'),
});

const buildDriveSelect = async () => {
  const cadetCompat = await getCadetCompatibility();
  const submissionCompat = await getSubmissionCompatibility();
  const hasRecruitmentCommunications = await hasTable('recruitment_communications');

  const shortlistedCondition = cadetCompat.hasWorkflowPhase
    ? "c.workflow_phase = 'shortlisted'"
    : "c.status IN ('Shortlisted', 'Eligible for Assessment')";

  const medicalQueueCondition = cadetCompat.hasWorkflowPhase
    ? "c.workflow_phase = 'medical'"
    : "c.status IN ('Selected', 'Eligible for Medical')";

  const revertedExcelFilters = [];
  if (submissionCompat.hasBatchYear) {
    revertedExcelFilters.push(
      'isub.batch_year = COALESCE(rd.year, YEAR(rd.created_at))',
    );
  }
  if (submissionCompat.hasCourseType) {
    revertedExcelFilters.push('isub.course_type = rd.course_type');
  }

  const revertedExcelWhere =
    revertedExcelFilters.length > 0
      ? ` AND ${revertedExcelFilters.join(' AND ')}`
      : '';

  const progressedDriveStatuses = [
    'Requested',
    'Received',
    'Submitted',
    'Shortlisted',
    'Assessment Completed',
    'Interview Completed',
    'Medical Completed',
    'Closed',
  ]
    .map((status) => `'${status}'`)
    .join(', ');

  const instituteRequestSentExpression = hasRecruitmentCommunications
    ? `CASE
        WHEN EXISTS (
          SELECT 1
          FROM recruitment_communications rc
          WHERE rc.drive_id = rd.id
            AND rc.communication_type = 'institute_request'
            AND LOWER(COALESCE(rc.send_status, 'sent')) = 'sent'
        )
          OR rd.status IN (${progressedDriveStatuses})
        THEN 1
        ELSE 0
      END`
    : `CASE
        WHEN rd.status IN (${progressedDriveStatuses})
        THEN 1
        ELSE 0
      END`;

  return `
    SELECT
      rd.*,
      i.institute_name,
      (
        SELECT COUNT(*)
        FROM cadets c
        WHERE c.drive_id = rd.id
      ) AS total_uploaded,
      (
        SELECT COUNT(*)
        FROM cadets c
        WHERE c.drive_id = rd.id
          AND ${shortlistedCondition}
      ) AS shortlisted_count,
      (
        SELECT COUNT(*)
        FROM cadets c
        JOIN assessments a ON a.cadet_id = c.id
        WHERE c.drive_id = rd.id
          AND LOWER(COALESCE(a.status, '')) = 'pass'
      ) AS assessment_passed,
      (
        SELECT COUNT(*)
        FROM cadets c
        JOIN interviews iv ON iv.cadet_id = c.id
        WHERE c.drive_id = rd.id
          AND LOWER(COALESCE(iv.final_decision, '')) = 'selected'
      ) AS interview_selected,
      (
        SELECT COUNT(*)
        FROM cadets c
        WHERE c.drive_id = rd.id
          AND ${medicalQueueCondition}
      ) AS medical_queue_count,
      (
        SELECT COUNT(*)
        FROM cadets c
        WHERE c.drive_id = rd.id
          AND c.status = 'CTV Assigned'
      ) AS ctv_assigned,
      (
        SELECT COUNT(*)
        FROM cadets c
        WHERE c.drive_id = rd.id
          AND c.status = 'Onboarded'
      ) AS onboarded,
      ${instituteRequestSentExpression} AS institute_email_sent,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM institute_submissions isub
          WHERE isub.institute_id = rd.institute_id${revertedExcelWhere}
        )
        THEN 1
        ELSE 0
      END AS institute_reverted_excel
    FROM recruitment_drives rd
    LEFT JOIN institutes i ON rd.institute_id = i.id
  `;
};

const createRecruitmentDrive = async (driveData) => {
  const {
    drive_name,
    institute_id,
    course_type,
    year,
    intake_capacity = 0,
    eligibility_criteria,
    status = 'Draft',
  } = driveData;

  const id = uuidv4();

  await db.query(
    `INSERT INTO recruitment_drives (id, drive_name, institute_id, course_type, year, intake_capacity, eligibility_criteria, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, drive_name, institute_id, course_type, year, intake_capacity, eligibility_criteria, status],
  );

  return id;
};

const getAllRecruitmentDrives = async (limit = 10, offset = 0, filters = {}) => {
  const driveSelect = await buildDriveSelect();
  let query = driveSelect;
  const queryParams = [];
  const whereClauses = [];

  if (filters.institute_id) {
    whereClauses.push('rd.institute_id = ?');
    queryParams.push(filters.institute_id);
  }

  if (filters.course_type && filters.course_type !== 'all') {
    whereClauses.push('rd.course_type = ?');
    queryParams.push(filters.course_type);
  }

  if (filters.status && filters.status !== 'all') {
    whereClauses.push('rd.status = ?');
    queryParams.push(filters.status);
  }

  if (filters.search) {
    whereClauses.push('(rd.drive_name LIKE ? OR i.institute_name LIKE ?)');
    const searchTerm = `%${filters.search}%`;
    queryParams.push(searchTerm, searchTerm);
  }

  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  query += ' ORDER BY rd.created_at DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);

  let countQuery =
    'SELECT COUNT(*) as total FROM recruitment_drives rd LEFT JOIN institutes i ON rd.institute_id = i.id';
  const countParams = [];
  if (whereClauses.length > 0) {
    countQuery += ` WHERE ${whereClauses.join(' AND ')}`;
    countParams.push(...queryParams.slice(0, queryParams.length - 2));
  }

  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data: rows, total };
};

const getRecruitmentDriveById = async (id) => {
  const driveSelect = await buildDriveSelect();
  const [rows] = await db.query(`${driveSelect} WHERE rd.id = ?`, [id]);
  return rows[0];
};

const getDriveByContext = async (instituteId, year, courseType) => {
  const [rows] = await db.query(
    `SELECT id
     FROM recruitment_drives
     WHERE institute_id = ?
       AND year = ?
       AND ? LIKE CONCAT('%', course_type, '%')
     ORDER BY created_at DESC
     LIMIT 1`,
    [instituteId, year, courseType],
  );
  return rows[0] || null;
};

const getDriveByName = async (driveName, excludeId = null) => {
  let query = `
    SELECT id, drive_name
    FROM recruitment_drives
    WHERE LOWER(TRIM(drive_name)) = LOWER(TRIM(?))
  `;
  const params = [driveName];

  if (excludeId) {
    query += ' AND id <> ?';
    params.push(excludeId);
  }

  query += ' LIMIT 1';
  const [rows] = await db.query(query, params);
  return rows[0] || null;
};

const getDriveByInstituteYearCourseType = async (instituteId, year, courseType, excludeId = null) => {
  let query = `
    SELECT id, drive_name, status
    FROM recruitment_drives
    WHERE institute_id = ?
      AND year = ?
      AND course_type = ?
  `;
  const params = [instituteId, year, courseType];

  if (excludeId) {
    query += ' AND id <> ?';
    params.push(excludeId);
  }

  query += ' LIMIT 1';
  const [rows] = await db.query(query, params);
  return rows[0] || null;
};

const updateRecruitmentDrive = async (id, driveData) => {
  const {
    drive_name,
    institute_id,
    course_type,
    year,
    intake_capacity,
    eligibility_criteria,
    status,
  } = driveData;

  const [result] = await db.query(
    `UPDATE recruitment_drives
     SET drive_name = COALESCE(?, drive_name),
         institute_id = COALESCE(?, institute_id),
         course_type = COALESCE(?, course_type),
         year = COALESCE(?, year),
         intake_capacity = COALESCE(?, intake_capacity),
         eligibility_criteria = COALESCE(?, eligibility_criteria),
         status = COALESCE(?, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [drive_name, institute_id, course_type, year, intake_capacity, eligibility_criteria, status, id],
  );

  return result.affectedRows > 0;
};

const deleteRecruitmentDrive = async (id) => {
  const [result] = await db.query('DELETE FROM recruitment_drives WHERE id = ?', [id]);
  return result.affectedRows > 0;
};

const getRecruitmentDriveStats = async (driveId) => {
  const cadetCompat = await getCadetCompatibility();

  const shortlistedCondition = cadetCompat.hasWorkflowPhase
    ? "workflow_phase = 'shortlisted'"
    : "status IN ('Shortlisted', 'Eligible for Assessment')";
  const assessmentQueueCondition = cadetCompat.hasWorkflowPhase
    ? "workflow_phase = 'assessment'"
    : "status IN ('Assessment', 'Eligible for Assessment')";
  const interviewQueueCondition = cadetCompat.hasWorkflowPhase
    ? "workflow_phase = 'interview'"
    : "status IN ('Interviewed', 'Eligible for Interview')";
  const medicalQueueCondition = cadetCompat.hasWorkflowPhase
    ? "workflow_phase = 'medical'"
    : "status IN ('Selected', 'Eligible for Medical')";
  const rejectedCondition = cadetCompat.hasWorkflowPhase
    ? "workflow_phase = 'rejected'"
    : "status IN ('Rejected', 'Assessment Failed', 'Interview Failed', 'Medical Failed')";

  const [rows] = await db.query(
    `SELECT
      COUNT(*) AS total_uploaded,
      SUM(CASE WHEN ${shortlistedCondition} THEN 1 ELSE 0 END) AS shortlisted_count,
      SUM(CASE WHEN ${assessmentQueueCondition} THEN 1 ELSE 0 END) AS assessment_queue_count,
      SUM(CASE WHEN ${interviewQueueCondition} THEN 1 ELSE 0 END) AS interview_queue_count,
      SUM(CASE WHEN ${medicalQueueCondition} THEN 1 ELSE 0 END) AS medical_queue_count,
      SUM(CASE WHEN ${rejectedCondition} THEN 1 ELSE 0 END) AS rejected_count,
      SUM(CASE WHEN status = 'CTV Assigned' THEN 1 ELSE 0 END) AS ctv_assigned,
      SUM(CASE WHEN status = 'Onboarded' THEN 1 ELSE 0 END) AS onboarded
     FROM cadets
     WHERE drive_id = ?`,
    [driveId],
  );

  const [assessmentRows] = await db.query(
    `SELECT COUNT(*) AS assessment_passed
     FROM cadets c
     JOIN assessments a ON a.cadet_id = c.id
     WHERE c.drive_id = ?
       AND LOWER(COALESCE(a.status, '')) = 'pass'`,
    [driveId],
  );

  const [interviewRows] = await db.query(
    `SELECT COUNT(*) AS interview_selected
     FROM cadets c
     JOIN interviews iv ON iv.cadet_id = c.id
     WHERE c.drive_id = ?
       AND LOWER(COALESCE(iv.final_decision, '')) = 'selected'`,
    [driveId],
  );

  return {
    ...rows[0],
    assessment_passed: assessmentRows[0]?.assessment_passed || 0,
    interview_selected: interviewRows[0]?.interview_selected || 0,
  };
};

module.exports = {
  createRecruitmentDrive,
  getAllRecruitmentDrives,
  getRecruitmentDriveById,
  getDriveByContext,
  getDriveByName,
  getDriveByInstituteYearCourseType,
  updateRecruitmentDrive,
  deleteRecruitmentDrive,
  getRecruitmentDriveStats,
};
