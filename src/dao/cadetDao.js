const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const {
  WORKFLOW_PHASES,
  DISPLAY_STATUS,
  hydrateCadetWorkflow,
} = require('../services/recruitmentWorkflowService');
const {
  hasColumn,
  hasTable,
  filterExistingColumns,
  getTableColumns,
} = require('../services/schemaCompatibilityService');

const getCadetCompatibility = async () => ({
  hasRollNo: await hasColumn('cadets', 'roll_no'),
  hasWorkflowPhase: await hasColumn('cadets', 'workflow_phase'),
  hasWorkflowResult: await hasColumn('cadets', 'workflow_result'),
  hasRejectionStage: await hasColumn('cadets', 'rejection_stage'),
  hasWorkflowUpdatedAt: await hasColumn('cadets', 'workflow_updated_at'),
  hasShortlistedAt: await hasColumn('cadets', 'shortlisted_at'),
  hasSelectedAt: await hasColumn('cadets', 'selected_at'),
  hasShortlistEmailSent: await hasColumn('cadets', 'shortlist_email_sent'),
  hasInstituteDetailFilled: await hasColumn('cadets', 'institute_detail_filled'),
});

const getAssessmentCompatibility = async () => ({
  hasAssessmentDate: await hasColumn('assessments', 'assessment_date'),
  hasAssessmentTime: await hasColumn('assessments', 'assessment_time'),
  hasInviteRemark: await hasColumn('assessments', 'invite_remark'),
  hasInviteDocumentLink: await hasColumn('assessments', 'invite_document_link'),
});

const getInterviewCompatibility = async () => ({
  hasInterviewTime: await hasColumn('interviews', 'interview_time'),
  hasComments: await hasColumn('interviews', 'comments'),
  hasInviteRemark: await hasColumn('interviews', 'invite_remark'),
  hasInviteDocumentLink: await hasColumn('interviews', 'invite_document_link'),
  hasInterviewers: await hasColumn('interviews', 'interviewers'),
});

const getMedicalCompatibility = async () => ({
  hasFinalDecision: await hasColumn('cadet_medical_results', 'final_decision'),
  hasPsychometricStatus: await hasColumn('cadet_medical_results', 'psychometric_status'),
  hasProfilingStatus: await hasColumn('cadet_medical_results', 'profiling_status'),
  hasInviteRemark: await hasColumn('cadet_medical_results', 'invite_remark'),
});

const getCadetColumnsSelect = async () => {
  const columnsSet = await getTableColumns('cadets');
  if (!columnsSet || columnsSet.size === 0) return 'c.*';

  const exclude = ['photo_data', 'photo_mime_type', 'photo_name'];
  const selectCols = [];
  for (const col of columnsSet) {
    if (!exclude.includes(col)) {
      selectCols.push(`c.${col}`);
    }
  }
  return selectCols.join(', ');
};

const buildBaseSelect = async () => {
  const cadetCompat = await getCadetCompatibility();
  const assessmentCompat = await getAssessmentCompatibility();
  const interviewCompat = await getInterviewCompatibility();
  const medicalCompat = await getMedicalCompatibility();
  const hasCadetDocuments = await hasTable('cadet_documents');
  const cadetCols = await getCadetColumnsSelect();

  const hasCvSelect = hasCadetDocuments
    ? `EXISTS (
        SELECT 1
        FROM cadet_documents cv
        WHERE cv.cadet_id = c.id
          AND UPPER(cv.document_type) = 'CV'
      ) AS has_cv`
    : '0 AS has_cv';

  const hasRecruitmentCommunications = await hasTable('recruitment_communications');

  const commSelects = hasRecruitmentCommunications
    ? `,
      (SELECT MAX(rc.sent_at) FROM recruitment_communications rc WHERE rc.cadet_id = c.id AND rc.communication_type = 'shortlist' AND rc.send_status = 'sent') AS shortlist_email_date,
      (SELECT MAX(rc.sent_at) FROM recruitment_communications rc WHERE rc.cadet_id = c.id AND rc.communication_type = 'assessment_invite' AND rc.send_status = 'sent') AS assessment_email_date,
      (SELECT MAX(rc.sent_at) FROM recruitment_communications rc WHERE rc.cadet_id = c.id AND rc.communication_type = 'interview_invite' AND rc.send_status = 'sent') AS interview_email_date,
      (SELECT MAX(rc.sent_at) FROM recruitment_communications rc WHERE rc.cadet_id = c.id AND rc.communication_type = 'medical_invite' AND rc.send_status = 'sent') AS medical_email_date,
      (SELECT MAX(rc.sent_at) FROM recruitment_communications rc WHERE rc.cadet_id = c.id AND rc.communication_type = 'document_request' AND rc.send_status = 'sent') AS document_email_date,
      (SELECT MAX(rc.sent_at) FROM recruitment_communications rc WHERE rc.cadet_id = c.id AND rc.send_status = 'sent') AS last_email_date,
      (SELECT rc.communication_type FROM recruitment_communications rc WHERE rc.cadet_id = c.id AND rc.send_status = 'sent' ORDER BY rc.sent_at DESC LIMIT 1) AS last_email_type
      `
    : `,
      NULL AS shortlist_email_date,
      NULL AS assessment_email_date,
      NULL AS interview_email_date,
      NULL AS medical_email_date,
      NULL AS document_email_date,
      NULL AS last_email_date,
      NULL AS last_email_type
      `;

  return `
    SELECT
      ${cadetCols},
      ${cadetCompat.hasRollNo ? 'c.roll_no' : 'NULL AS roll_no'},
      ${cadetCompat.hasWorkflowPhase ? 'c.workflow_phase' : 'NULL AS workflow_phase'},
      ${cadetCompat.hasWorkflowResult ? 'c.workflow_result' : 'NULL AS workflow_result'},
      ${cadetCompat.hasRejectionStage ? 'c.rejection_stage' : 'NULL AS rejection_stage'},
      ${cadetCompat.hasWorkflowUpdatedAt ? 'c.workflow_updated_at' : 'NULL AS workflow_updated_at'},
      ${cadetCompat.hasShortlistedAt ? 'c.shortlisted_at' : 'NULL AS shortlisted_at'},
      ${cadetCompat.hasSelectedAt ? 'c.selected_at' : 'NULL AS selected_at'},
      ${cadetCompat.hasShortlistEmailSent ? 'c.shortlist_email_sent' : '0 AS shortlist_email_sent'},
      ${cadetCompat.hasInstituteDetailFilled ? 'c.institute_detail_filled' : '0 AS institute_detail_filled'},
      i.institute_name,
      i.institute_upload_type,
      rd.drive_name,
      a.id AS assessment_id,
      ${assessmentCompat.hasAssessmentDate ? 'a.assessment_date' : 'NULL AS assessment_date'},
      ${assessmentCompat.hasAssessmentTime ? 'a.assessment_time' : 'NULL AS assessment_time'},
      a.ces_test,
      a.ces_test_2,
      a.english_test,
      a.essay_writing_mark,
      a.calculated_score,
      a.calculated_score AS assessment_score,
      a.remarks AS assessment_remarks,
      a.status AS assessment_status,
      a.mark_for_interview,
      ${assessmentCompat.hasInviteRemark ? 'a.invite_remark' : 'NULL AS assessment_invite_remark'},
      ${assessmentCompat.hasInviteDocumentLink ? 'a.invite_document_link' : 'NULL AS assessment_invite_document_link'},
      iv.id AS interview_id,
      iv.interview_date,
      ${interviewCompat.hasInterviewTime ? 'iv.interview_time' : 'NULL AS interview_time'},
      iv.panel_members,
      ${interviewCompat.hasInterviewers ? 'iv.interviewers' : 'NULL AS interviewers'},
      iv.evaluation_score,
      iv.total_score,
      iv.final_decision AS interview_final_decision,
      iv.remarks AS interview_remarks,
      ${interviewCompat.hasComments ? 'iv.comments AS interview_comments' : 'NULL AS interview_comments'},
      ${interviewCompat.hasInviteRemark ? 'iv.invite_remark' : 'NULL AS interview_invite_remark'},
      ${interviewCompat.hasInviteDocumentLink ? 'iv.invite_document_link' : 'NULL AS interview_invite_document_link'},
      mr.id AS medical_result_id,
      mr.appointment_date AS medical_date,
      mr.appointment_time AS medical_time,
      mr.status AS fit_status,
      ${medicalCompat.hasFinalDecision ? 'mr.final_decision AS medical_final_decision' : 'NULL AS medical_final_decision'},
      ${medicalCompat.hasPsychometricStatus ? 'mr.psychometric_status' : 'NULL AS psychometric_status'},
      ${medicalCompat.hasProfilingStatus ? 'mr.profiling_status' : 'NULL AS profiling_status'},
      mr.remarks AS medical_remarks,
      ${medicalCompat.hasInviteRemark ? 'mr.invite_remark' : 'NULL AS medical_invite_remark'},
      mc.center_name AS medical_center_name,
      ${hasCvSelect},
      COALESCE(c.imu_avg_all_semester_percentage, c.twelfth_pcm_avg_percentage, c.tenth_avg_percentage) AS cadet_percentage${commSelects}
    FROM cadets c
    LEFT JOIN institutes i ON c.institute_id = i.id
    LEFT JOIN recruitment_drives rd ON c.drive_id = rd.id
    LEFT JOIN assessments a ON c.id = a.cadet_id
    LEFT JOIN interviews iv ON c.id = iv.cadet_id
    LEFT JOIN cadet_medical_results mr ON c.id = mr.cadet_id
    LEFT JOIN medical_centers mc ON mr.medical_center_id = mc.id
  `;
};

const canEditPendingDetails = (cadet = {}) => {
  if (cadet.workflow_result === 'academic_data_collected') {
    return true;
  }
  if (Number(cadet.shortlist_email_sent || 0) !== 1) {
    return false;
  }
  const nonEditablePhases = [
    WORKFLOW_PHASES.INTERVIEW,
    WORKFLOW_PHASES.MEDICAL,
    WORKFLOW_PHASES.SELECTED,
    WORKFLOW_PHASES.REJECTED
  ];
  return !nonEditablePhases.includes(cadet.workflow_phase);
};

const mapCadetRow = (row) => {
  const cadet = hydrateCadetWorkflow(row);
  return {
    ...cadet,
    can_edit_pending_details: canEditPendingDetails(cadet),
    has_pending_academic_request: cadet.workflow_result === 'academic_data_collected',
  };
};

const generateUniqueCadetId = async () => {
  const currentYear = new Date().getFullYear();
  const query =
    'SELECT MAX(SUBSTRING_INDEX(cadet_unique_id, "-", -1)) as lastNum FROM cadets WHERE cadet_unique_id LIKE ?';
  const [rows] = await db.query(query, [`${currentYear}-%`]);

  const lastNum = rows[0].lastNum ? parseInt(rows[0].lastNum, 10) : 0;
  const nextNum = String(lastNum + 1).padStart(4, '0');
  return `${currentYear}-${nextNum}`;
};

const createCadet = async (cadetData) => {
  const id = uuidv4();
  const cadetUniqueId = await generateUniqueCadetId();

  const finalData = {
    workflow_phase: WORKFLOW_PHASES.UPLOADED,
    workflow_result: 'pending',
    status: DISPLAY_STATUS.UPLOADED,
    ...cadetData,
    id,
    cadet_unique_id: cadetUniqueId,
  };

  if (!finalData.status || finalData.status === 'Imported') {
    finalData.status = DISPLAY_STATUS.UPLOADED;
  }

  if (!finalData.workflow_phase) {
    finalData.workflow_phase = WORKFLOW_PHASES.UPLOADED;
  }

  if (!finalData.workflow_result) {
    finalData.workflow_result = 'pending';
  }

  const insertData = await filterExistingColumns('cadets', finalData);
  const fields = Object.keys(insertData);
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map((field) => insertData[field]);

  await db.query(
    `INSERT INTO cadets (${fields.join(', ')}) VALUES (${placeholders})`,
    values,
  );

  return id;
};

const findDuplicateCadet = async (cadetData = {}) => {
  const instituteId = cadetData.institute_id;
  const batchYear = cadetData.batch_year;
  const name = cadetData.name_as_in_indos_cert;
  const course = cadetData.course;

  if (!instituteId || !batchYear || !name || !course) {
    return null;
  }

  let query = `
    SELECT id
    FROM cadets
    WHERE institute_id = ?
      AND batch_year = ?
      AND LOWER(TRIM(name_as_in_indos_cert)) = LOWER(TRIM(?))
      AND LOWER(TRIM(course)) = LOWER(TRIM(?))
  `;
  const params = [instituteId, batchYear, name, course];
  const identityClauses = [];

  if (cadetData.date_of_birth) {
    identityClauses.push('date_of_birth = ?');
    params.push(cadetData.date_of_birth);
  }

  if (cadetData.email_id) {
    identityClauses.push('LOWER(TRIM(email_id)) = LOWER(TRIM(?))');
    params.push(cadetData.email_id);
  }

  if (cadetData.contact_number) {
    identityClauses.push(
      "REPLACE(REPLACE(TRIM(contact_number), ' ', ''), '-', '') = REPLACE(REPLACE(TRIM(?), ' ', ''), '-', '')",
    );
    params.push(cadetData.contact_number);
  }

  if (identityClauses.length > 0) {
    query += ` AND (${identityClauses.join(' OR ')})`;
  }

  query += ' LIMIT 1';
  const [rows] = await db.query(query, params);
  return rows[0] || null;
};

const buildWhereClause = (filters = {}, queryParams = [], options = {}) => {
  const whereClauses = [];
  const searchColumns = [
    'c.name_as_in_indos_cert LIKE ?',
    'c.email_id LIKE ?',
    'c.contact_number LIKE ?',
    'c.cadet_unique_id LIKE ?',
  ];

  if (options.hasRollNo) {
    searchColumns.push('c.roll_no LIKE ?');
  }

  if (filters.batch_year && filters.batch_year !== 'all') {
    whereClauses.push('c.batch_year = ?');
    queryParams.push(filters.batch_year);
  }

  if (filters.instituteId) {
    whereClauses.push('c.institute_id = ?');
    queryParams.push(filters.instituteId);
  }

  if (filters.drive_id) {
    if (filters.drive_id === 'null' || filters.drive_id === 'unassigned') {
      whereClauses.push('c.drive_id IS NULL');
    } else {
      whereClauses.push('c.drive_id = ?');
      queryParams.push(filters.drive_id);
    }
  }

  if (filters.course_type && filters.course_type !== 'all') {
    whereClauses.push('c.course LIKE ?');
    queryParams.push(`%${filters.course_type}%`);
  }

  if (filters.batch) {
    whereClauses.push('c.batch LIKE ?');
    queryParams.push(`%${filters.batch}%`);
  }

  if (filters.workflow_phase && options.hasWorkflowPhase) {
    whereClauses.push('c.workflow_phase = ?');
    queryParams.push(filters.workflow_phase);
  }

  if (filters.status && filters.status !== 'all') {
    whereClauses.push('c.status = ?');
    queryParams.push(filters.status);
  }

  if (filters.search) {
    whereClauses.push(`(${searchColumns.join(' OR ')})`);
    const searchTerm = `%${filters.search}%`;
    const searchValues = new Array(searchColumns.length).fill(searchTerm);
    queryParams.push(...searchValues);
  }

  return whereClauses;
};

const getAllCadets = async (limit = 10, offset = 0, filters = {}) => {
  const cadetCompat = await getCadetCompatibility();
  const baseSelect = await buildBaseSelect();
  const queryParams = [];
  const whereClauses = buildWhereClause(filters, queryParams, cadetCompat);

  let query = baseSelect;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);
  const data = rows.map(mapCadetRow);

  let countQuery = 'SELECT COUNT(*) AS total FROM cadets c';
  const countParams = [];
  const countWhereClauses = buildWhereClause(filters, countParams, cadetCompat);
  if (countWhereClauses.length > 0) {
    countQuery += ` WHERE ${countWhereClauses.join(' AND ')}`;
  }

  const [[{ total }]] = await db.query(countQuery, countParams);

  return { data, total };
};

const getCadetById = async (id) => {
  const baseSelect = await buildBaseSelect();
  const [rows] = await db.query(`${baseSelect} WHERE c.id = ?`, [id]);
  const cadet = rows[0];

  if (!cadet) return null;

  delete cadet.photo_data;
  delete cadet.photo_mime_type;
  delete cadet.photo_name;

  return mapCadetRow(cadet);
};

const getCadetsByIds = async (ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const baseSelect = await buildBaseSelect();
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await db.query(
    `${baseSelect} WHERE c.id IN (${placeholders})`,
    ids,
  );

  return rows.map((row) => {
    delete row.photo_data;
    delete row.photo_mime_type;
    delete row.photo_name;
    return mapCadetRow(row);
  });
};

const getLegacyQueueCondition = (queue) => {
  switch (queue) {
    case 'assessment':
      return {
        clause: "c.status IN ('Shortlisted', 'Assessment', 'Eligible for Assessment', 'Assessment Failed', 'Interviewed', 'Eligible for Interview', 'Interview Selected', 'Interview Failed')",
        params: [],
      };
    case 'interview':
      return {
        clause: "c.status IN ('Interviewed', 'Eligible for Interview', 'Interview Selected', 'Interview Failed')",
        params: [],
      };
    case 'medical':
      return {
        clause: "c.status IN ('Selected', 'Eligible for Medical', 'Interview Selected', 'Medical Completed', 'Medical Failed')",
        params: [],
      };
    case 'selected':
      return {
        clause: "c.status IN ('Selected', 'Medical Completed', 'CTV Assigned', 'Onboarded')",
        params: [],
      };
    case 'rejected':
      return {
        clause: "c.status IN ('Rejected', 'Assessment Failed', 'Interview Failed', 'Medical Failed')",
        params: [],
      };
    default:
      return null;
  }
};

const buildDriveCadetsWhere = async (
  driveId,
  { queue = 'all', search = '', status, excludeUploaded = false } = {},
) => {
  const cadetCompat = await getCadetCompatibility();
  const queryParams = [driveId];
  const whereClauses = ['c.drive_id = ?'];
  const searchColumns = [
    'c.name_as_in_indos_cert LIKE ?',
    'c.email_id LIKE ?',
    'c.cadet_unique_id LIKE ?',
  ];

  if (cadetCompat.hasRollNo) {
    searchColumns.push('c.roll_no LIKE ?');
  }

  if (cadetCompat.hasWorkflowPhase) {
    switch (queue) {
      case 'shortlist':
        whereClauses.push(`(
          c.workflow_phase IN (?, ?)
          OR LOWER(COALESCE(a.status, '')) IN ('pass', 'fail')
        )`);
        queryParams.push(WORKFLOW_PHASES.UPLOADED, WORKFLOW_PHASES.SHORTLISTED);
        break;
      case 'assessment':
        whereClauses.push(`(
          c.workflow_phase IN (?, ?, ?)
          OR LOWER(COALESCE(a.status, '')) IN ('pass', 'fail', 'completed', 'complete', 'assessment completed')
          OR c.status IN ('Assessment Passed', 'Assessment Failed', 'Assessment Completed')
        )`);
        queryParams.push(
          WORKFLOW_PHASES.SHORTLISTED,
          WORKFLOW_PHASES.ASSESSMENT,
          WORKFLOW_PHASES.INTERVIEW
        );
        break;
      case 'interview':
        whereClauses.push(`(
          c.workflow_phase = ?
          OR LOWER(COALESCE(iv.final_decision, '')) IN ('selected', 'rejected', 'waitlisted', 'pass', 'fail')
          OR c.status IN ('Interviewed', 'Eligible for Interview', 'Interview Selected', 'Interview Failed')
        )`);
        queryParams.push(WORKFLOW_PHASES.INTERVIEW);
        break;
      case 'medical':
        whereClauses.push(`(
          c.workflow_phase = ?
          OR LOWER(COALESCE(iv.final_decision, '')) IN ('selected', 'pass')
          OR c.status IN ('Selected', 'Eligible for Medical', 'Interview Selected', 'Medical Completed', 'Medical Failed')
          OR mr.id IS NOT NULL
        )`);
        queryParams.push(WORKFLOW_PHASES.MEDICAL);
        break;
      case 'selected':
        whereClauses.push('c.workflow_phase = ?');
        queryParams.push(WORKFLOW_PHASES.SELECTED);
        break;
      case 'rejected':
        whereClauses.push('c.workflow_phase = ?');
        queryParams.push(WORKFLOW_PHASES.REJECTED);
        break;
      default:
        break;
    }
  } else {
    const legacyQueue =
      queue === 'shortlist'
        ? {
            clause: "c.status IN ('Uploaded', 'Shortlisted', 'Assessment Passed', 'Assessment Failed')",
            params: [],
          }
        : getLegacyQueueCondition(queue);
    if (legacyQueue) {
      whereClauses.push(legacyQueue.clause);
      queryParams.push(...legacyQueue.params);
    }
  }

  if (status && status !== 'all') {
    whereClauses.push('c.status = ?');
    queryParams.push(status);
  }

  if (excludeUploaded) {
    if (cadetCompat.hasWorkflowPhase) {
      whereClauses.push('(c.workflow_phase IS NULL OR c.workflow_phase <> ?)');
      queryParams.push(WORKFLOW_PHASES.UPLOADED);
    } else {
      whereClauses.push("c.status <> 'Uploaded'");
    }
  }

  if (search) {
    whereClauses.push(`(${searchColumns.join(' OR ')})`);
    const searchTerm = `%${search}%`;
    queryParams.push(...new Array(searchColumns.length).fill(searchTerm));
  }

  return { whereClauses, queryParams };
};

const getDriveCadets = async (
  driveId,
  {
    queue = 'all',
    search = '',
    status,
    sortBy = 'created_at',
    sortOrder = 'DESC',
    limit = 1000,
    offset = 0,
    excludeUploaded = false,
    isInstitute = false,
  } = {},
) => {
  const baseSelect = await buildBaseSelect();
  const { whereClauses, queryParams } = await buildDriveCadetsWhere(driveId, {
    queue,
    search,
    status,
    excludeUploaded,
  });
  const sortColumns = {
    created_at: 'c.created_at',
    name_as_in_indos_cert: 'c.name_as_in_indos_cert',
    cadet_unique_id: 'c.cadet_unique_id',
    status: 'c.status',
    workflow_updated_at: 'c.workflow_updated_at',
  };
  const orderBy = sortColumns[sortBy] || sortColumns.created_at;
  const orderDirection = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  let orderClause = `${orderBy} ${orderDirection}`;
  if (isInstitute) {
    orderClause = `CASE WHEN c.workflow_result = 'academic_data_collected' THEN 1 WHEN (COALESCE(c.shortlist_email_sent, 0) = 1 AND (c.workflow_phase IS NULL OR c.workflow_phase NOT IN ('interview', 'medical', 'selected', 'rejected'))) THEN 1 ELSE 0 END DESC, ${orderClause}`;
  }
  if (queue === 'shortlist') {
    orderClause = `CASE
      WHEN CAST(c.tenth_avg_percentage AS DECIMAL(10,2)) >= 60
        AND CAST(c.twelfth_pcm_avg_percentage AS DECIMAL(10,2)) >= 60
        AND CAST(c.twelfth_std_english AS DECIMAL(10,2)) >= 70
      THEN 0
      ELSE 1
    END ASC, ${orderClause}`;
  }

  const [rows] = await db.query(
    `${baseSelect} WHERE ${whereClauses.join(' AND ')} ORDER BY ${orderClause} LIMIT ? OFFSET ?`,
    [...queryParams, limit, offset],
  );

  return rows.map(mapCadetRow);
};

const getDriveCadetsCount = async (
  driveId,
  { queue = 'all', search = '', status, excludeUploaded = false } = {},
) => {
  const { whereClauses, queryParams } = await buildDriveCadetsWhere(driveId, {
    queue,
    search,
    status,
    excludeUploaded,
  });

  const [[{ total }]] = await db.query(
    `SELECT COUNT(DISTINCT c.id) AS total
     FROM cadets c
     LEFT JOIN assessments a ON c.id = a.cadet_id
     LEFT JOIN interviews iv ON c.id = iv.cadet_id
     LEFT JOIN cadet_medical_results mr ON c.id = mr.cadet_id
     WHERE ${whereClauses.join(' AND ')}`,
    queryParams,
  );

  return total || 0;
};

const getShortlistedCadets = async (limit = 10, offset = 0, filters = {}) => {
  let query = `
    SELECT c.*, i.institute_name, rd.drive_name
    FROM cadets c
    LEFT JOIN institutes i ON c.institute_id = i.id
    LEFT JOIN recruitment_drives rd ON c.drive_id = rd.id
    WHERE CAST(c.tenth_avg_percentage AS DECIMAL(10,2)) >= 60
      AND CAST(c.twelfth_pcm_avg_percentage AS DECIMAL(10,2)) >= 60
      AND CAST(c.twelfth_std_english AS DECIMAL(10,2)) >= 70
  `;
  const queryParams = [];
  const additionalClauses = [];

  if (filters.batch_year && filters.batch_year !== 'all') {
    additionalClauses.push('c.batch_year = ?');
    queryParams.push(filters.batch_year);
  }

  if (filters.instituteId) {
    additionalClauses.push('c.institute_id = ?');
    queryParams.push(filters.instituteId);
  }

  if (filters.drive_id && filters.drive_id !== 'all') {
    if (filters.drive_id === 'null' || filters.drive_id === 'unassigned') {
      additionalClauses.push('c.drive_id IS NULL');
    } else {
      additionalClauses.push('c.drive_id = ?');
      queryParams.push(filters.drive_id);
    }
  }

  if (filters.course_type && filters.course_type !== 'all') {
    additionalClauses.push('c.course LIKE ?');
    queryParams.push(`%${filters.course_type}%`);
  }

  if (filters.search) {
    additionalClauses.push(
      '(c.name_as_in_indos_cert LIKE ? OR c.email_id LIKE ? OR c.contact_number LIKE ?)',
    );
    const searchTerm = `%${filters.search}%`;
    queryParams.push(searchTerm, searchTerm, searchTerm);
  }

  if (additionalClauses.length > 0) {
    query += ` AND ${additionalClauses.join(' AND ')}`;
  }

  query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const [rows] = await db.query(query, queryParams);

  let countQuery = `
    SELECT COUNT(*) as total
    FROM cadets c
    WHERE CAST(c.tenth_avg_percentage AS DECIMAL(10,2)) >= 60
      AND CAST(c.twelfth_pcm_avg_percentage AS DECIMAL(10,2)) >= 60
      AND CAST(c.twelfth_std_english AS DECIMAL(10,2)) >= 70
  `;
  const countParams = queryParams.slice(0, queryParams.length - 2);

  if (additionalClauses.length > 0) {
    countQuery += ` AND ${additionalClauses.join(' AND ')}`;
  }

  try {
    const [[{ total }]] = await db.query(countQuery, countParams);
    return { data: rows.map(mapCadetRow), total };
  } catch (error) {
    return { data: [], total: 0 };
  }
};

const getShortlistCountByInstitute = async () => {
  const query = `
    SELECT
      i.id as institute_id,
      i.institute_name,
      COUNT(c.id) as count
    FROM institutes i
    LEFT JOIN cadets c ON i.id = c.institute_id
      AND CAST(c.tenth_avg_percentage AS DECIMAL(10,2)) >= 60
      AND CAST(c.twelfth_pcm_avg_percentage AS DECIMAL(10,2)) >= 60
      AND CAST(c.twelfth_std_english AS DECIMAL(10,2)) >= 70
    GROUP BY i.id, i.institute_name
    HAVING count > 0
    ORDER BY count DESC
  `;

  try {
    const [rows] = await db.query(query);
    return rows;
  } catch (error) {
    return [];
  }
};

const updateCadet = async (id, cadetData) => {
  const filteredData = await filterExistingColumns('cadets', cadetData);
  const updateFields = [];
  const values = [];

  Object.keys(filteredData).forEach((field) => {
    updateFields.push(`${field} = ?`);
    values.push(filteredData[field]);
  });

  if (updateFields.length === 0) return;

  values.push(id);
  await db.query(`UPDATE cadets SET ${updateFields.join(', ')} WHERE id = ?`, values);
};

const bulkUpdateCadets = async (ids = [], cadetData = {}) => {
  if (!ids.length) return 0;

  const filteredData = await filterExistingColumns('cadets', cadetData);
  const updateFields = [];
  const values = [];

  Object.keys(filteredData).forEach((field) => {
    updateFields.push(`${field} = ?`);
    values.push(filteredData[field]);
  });

  if (!updateFields.length) return 0;

  const placeholders = ids.map(() => '?').join(', ');
  const [result] = await db.query(
    `UPDATE cadets SET ${updateFields.join(', ')} WHERE id IN (${placeholders})`,
    [...values, ...ids],
  );

  return result.affectedRows;
};

const deleteCadet = async (id) => {
  await db.query('DELETE FROM cadets WHERE id = ?', [id]);
};

const saveCadetPhoto = async (cadetId, photoBuffer, mimeType, photoName) => {
  await db.query(
    'UPDATE cadets SET photo_data = NULL, photo_mime_type = ?, photo_name = ? WHERE id = ?',
    [mimeType, photoName, cadetId],
  );
};

const getMaxAllowedPacket = async () => {
  try {
    const [rows] = await db.query("SHOW VARIABLES LIKE 'max_allowed_packet'");
    const value = Number(rows?.[0]?.Value);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    return null;
  }
};

const getCadetPhoto = async (cadetId) => {
  const [rows] = await db.query(
    'SELECT photo_data, photo_mime_type FROM cadets WHERE id = ?',
    [cadetId],
  );
  if (rows.length === 0 || !rows[0].photo_data) return null;
  return rows[0];
};

const getInstituteAcademicRequestCadets = async (instituteId, search = '', driveId = null) => {
  const baseSelect = await buildBaseSelect();
  const params = [instituteId];
  let query = `${baseSelect} WHERE c.institute_id = ? AND c.workflow_result = 'academic_data_collected'`;

  if (driveId && driveId !== 'all') {
    if (driveId === 'null' || driveId === 'unassigned') {
      query += ` AND c.drive_id IS NULL`;
    } else {
      query += ` AND c.drive_id = ?`;
      params.push(driveId);
    }
  }

  if (search) {
    query += ` AND (c.name_as_in_indos_cert LIKE ? OR c.email_id LIKE ? OR c.cadet_unique_id LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  query += ' ORDER BY c.created_at DESC LIMIT 200';
  const [rows] = await db.query(query, params);
  return rows.map(mapCadetRow);
};

const getInstitutePendingSummary = async (instituteId) => {
  const query = `
    SELECT 
      c.drive_id,
      rd.drive_name,
      COUNT(c.id) AS pending_count
    FROM cadets c
    LEFT JOIN recruitment_drives rd ON c.drive_id = rd.id
    WHERE c.institute_id = ? 
      AND c.workflow_result = 'academic_data_collected'
    GROUP BY c.drive_id, rd.drive_name
  `;
  const [rows] = await db.query(query, [instituteId]);
  return rows;
};

const checkDrivesHaveMedical = async (driveIds = []) => {
  if (!Array.isArray(driveIds) || driveIds.length === 0) return {};

  const placeholders = driveIds.map(() => '?').join(', ');
  const query = `
    SELECT drive_id, COUNT(id) AS medical_cadets_count
    FROM cadets
    WHERE drive_id IN (${placeholders})
      AND (
        workflow_phase IN ('medical', 'selected')
        OR status IN ('Medical Completed', 'Medical Failed', 'Eligible for Medical', 'Interview Selected')
      )
    GROUP BY drive_id
  `;
  const [rows] = await db.query(query, driveIds);
  
  const map = {};
  driveIds.forEach(id => {
    map[id] = false;
  });
  rows.forEach(row => {
    if (row.medical_cadets_count > 0) {
      map[row.drive_id] = true;
    }
  });
  return map;
};

module.exports = {
  createCadet,
  findDuplicateCadet,
  getAllCadets,
  getCadetById,
  getCadetsByIds,
  getDriveCadets,
  getDriveCadetsCount,
  getShortlistedCadets,
  getShortlistCountByInstitute,
  updateCadet,
  bulkUpdateCadets,
  deleteCadet,
  saveCadetPhoto,
  getMaxAllowedPacket,
  getCadetPhoto,
  canEditPendingDetails,
  getInstituteAcademicRequestCadets,
  getInstitutePendingSummary,
  checkDrivesHaveMedical,
};


