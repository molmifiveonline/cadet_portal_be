const db = require('../config/database');
const { unixTimestampToIso } = require('../utils/dateUtils');
const {
  hasColumn,
  hasTable,
} = require('../services/schemaCompatibilityService');
const {
  cadetScope,
  streamExpression,
  buildPipeline,
} = require('../services/dashboardScope');

const stages = [
  { key: 'applied', label: 'Applied', tab: 'cadets' },
  { key: 'shortlisted', label: 'Shortlisted', tab: 'shortlist' },
  { key: 'assessment', label: 'Assessment passed', tab: 'assessment' },
  { key: 'interview', label: 'Interview selected', tab: 'interview' },
  { key: 'medical', label: 'Medical cleared', tab: 'medical' },
  { key: 'allocated', label: 'Vessel assigned', tab: 'documents' },
];

// User IDs and cadet IDs are different identities. Use the current account
// email, and fail closed if imported cadets have ambiguous email addresses.
const resolveCadetId = async (userId) => {
  const [rows] = await db.query(
    `SELECT c.id FROM cadets c JOIN users u
    ON LOWER(TRIM(c.email_id)) = LOWER(TRIM(u.email)) WHERE u.id = ? LIMIT 2`,
    [userId],
  );
  return rows.length === 1 ? rows[0].id : null;
};

const getConditions = async () => {
  // Warm the shared schema cache once before the parallel table checks.
  const workflow = await hasColumn('cadets', 'workflow_phase');
  const names = [
    'assessments',
    'interviews',
    'cadet_medical_results',
    'cadet_documents',
    'document_verifications',
    'allocations',
    'allocation_rank_lists',
    'allocation_cycles',
    'onboarding',
    'vessels',
    'activity_logs',
    'institute_submissions',
  ];
  const exists = Object.fromEntries(
    await Promise.all(names.map(async (name) => [name, await hasTable(name)])),
  );
  const result = await hasColumn('cadets', 'workflow_result');
  const allocation =
    exists.allocations &&
    (await hasColumn('allocations', 'is_active')) &&
    (await hasColumn('allocations', 'secondary_vessel_id')) &&
    exists.allocation_rank_lists && exists.allocation_cycles &&
    (await hasColumn('allocation_cycles', 'deleted_at'));
  const allocated = allocation
    ? `EXISTS (SELECT 1 FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id WHERE a.cadet_id=c.id AND a.is_active=1 AND ac.deleted_at IS NULL AND
    ((a.vessel_id IS NOT NULL AND a.allocation_status='Allocated') OR (a.secondary_vessel_id IS NOT NULL AND a.secondary_allocation_status='Allocated')))`
    : "c.status IN ('CTV Assigned','Onboarded')";
  const medical = result
    ? "c.workflow_result IN ('medical_passed','ctv_assigned','onboarded')"
    : "c.status IN ('Medical Completed','CTV Assigned','Onboarded')";
  const interview = exists.interviews
    ? "EXISTS (SELECT 1 FROM interviews iv WHERE iv.cadet_id=c.id AND LOWER(iv.final_decision) IN ('selected','pass'))"
    : "c.status IN ('Interview Selected','Selected','Eligible for Medical','Medical Completed','CTV Assigned','Onboarded')";
  const assessment = exists.assessments
    ? "EXISTS (SELECT 1 FROM assessments a WHERE a.cadet_id=c.id AND LOWER(a.status)='pass')"
    : "c.status IN ('Assessment Passed','Eligible for Interview','Interview Selected','Selected','Eligible for Medical','Medical Completed','CTV Assigned','Onboarded')";
  const shortlisted = workflow
    ? "(c.workflow_phase IN ('shortlisted','assessment','interview','medical','selected') OR (c.workflow_phase='rejected' AND c.rejection_stage IN ('assessment','interview','medical','selected')))"
    : "c.status IN ('Shortlisted','Eligible for Assessment','Assessment Passed','Assessment Failed','Interviewed','Eligible for Interview','Interview Selected','Interview Failed','Selected','Eligible for Medical','Medical Completed','Medical Failed','CTV Assigned','Onboarded')";
  const readyAvailable =
    exists.cadet_documents &&
    exists.document_verifications &&
    allocation &&
    exists.allocation_rank_lists &&
    exists.allocation_cycles;
  const ready = readyAvailable
    ? `(${workflow ? "c.workflow_phase='selected' OR " : ''}c.status IN ('Selected','Medical Completed','CTV Assigned'))
    AND c.status <> 'Onboarded' ${result ? "AND COALESCE(c.workflow_result,'') <> 'onboarded'" : ''}
    AND EXISTS (SELECT 1 FROM document_verifications dv WHERE dv.cadet_id=c.id AND dv.status='Verified')
    AND EXISTS (SELECT 1 FROM cadet_documents cd WHERE cd.cadet_id=c.id)
    AND NOT EXISTS (SELECT 1 FROM cadet_documents cd WHERE cd.cadet_id=c.id AND COALESCE(cd.status,'') <> 'accepted')
    AND NOT EXISTS (SELECT 1 FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id WHERE a.cadet_id=c.id AND a.is_active=1 AND ac.status='Active' AND ac.deleted_at IS NULL)
    AND (${streamExpression}) IN ('Deck','Engine') AND c.imu_avg_all_semester_percentage BETWEEN 0 AND 100`
    : '0';
  return {
    exists,
    allocation,
    readyAvailable,
    ready,
    applied: '1=1',
    shortlisted,
    assessment,
    interview,
    medical,
    allocated,
  };
};

const getDashboardStats = async (filters = {}, access = {}, pages = {}) => {
  const conditions = await getConditions();
  const scope = cadetScope(filters, access);
  const baseScope = cadetScope({}, access);
  const unavailable = new Set();
  const query = async (key, sql, params = [], available = true) => {
    if (!available) {
      unavailable.add(key);
      return [];
    }
    try {
      return (await db.query(sql, params))[0];
    } catch (error) {
      if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error.code))
        throw error;
      console.warn(`Dashboard ${key} unavailable: ${error.code}`);
      unavailable.add(key);
      return [];
    }
  };
  const queue = async (
    key,
    select,
    from,
    extra,
    page = 1,
    available = true,
  ) => {
    const where = `${scope.sql} AND (${extra})`;
    const totals = await query(
      key,
      `SELECT COUNT(*) AS total ${from} WHERE ${where}`,
      scope.params,
      available,
    );
    const total = Number(totals[0]?.total || 0);
    const currentPage = Math.min(page, Math.max(1, Math.ceil(total / 5)));
    const order =
      key === 'documents'
        ? 'cd.created_at ASC, cd.id ASC'
        : key === 'onboarding'
          ? 'c.created_at ASC, o.id ASC'
          : 'c.created_at ASC, c.id ASC';
    const rows = await query(
      key,
      `SELECT ${select} ${from} WHERE ${where} ORDER BY ${order} LIMIT 5 OFFSET ?`,
      [...scope.params, (currentPage - 1) * 5],
      available,
    );
    return { rows, total, page: currentPage, pageSize: 5 };
  };
  const candidateSelect =
    'c.id, c.cadet_unique_id, c.name_as_in_indos_cert, c.course, c.drive_id, c.status, i.institute_name';
  const candidateFrom =
    'FROM cadets c LEFT JOIN institutes i ON i.id=c.institute_id';
  const institute = access.role === 'Institute';
  const personal = access.role === 'Cadet';
  const instituteClauses = [];
  const instituteParams = [];
  if (institute) {
    instituteClauses.push('i.id=?');
    instituteParams.push(access.instituteId);
  }
  if (!institute && Object.keys(filters).length) {
    instituteClauses.push(
      `EXISTS (SELECT 1 FROM cadets c WHERE c.institute_id=i.id AND ${scope.sql})`,
    );
    instituteParams.push(...scope.params);
  }
  const instituteWhere = instituteClauses.length
    ? ` AND ${instituteClauses.join(' AND ')}`
    : '';
  const [
    summaryRows,
    streams,
    genders,
    topInstitutes,
    docs,
    ready,
    onboarding,
    alerts,
    drives,
    batches,
    fleet,
    activity,
    submissions,
    personalRows,
    personalDocs,
    assignment,
  ] = await Promise.all([
    query(
      'summary',
      `SELECT COUNT(*) AS totalCandidates, COUNT(DISTINCT c.institute_id) AS totalInstitutes,
      ${stages.map((stage) => `COALESCE(SUM(CASE WHEN ${conditions[stage.key]} THEN 1 ELSE 0 END),0) AS ${stage.key}`).join(',')}
      FROM cadets c WHERE ${scope.sql}`,
      scope.params,
    ),
    query(
      'demographics',
      `SELECT (${streamExpression}) AS label, COUNT(*) AS count FROM cadets c WHERE ${scope.sql} GROUP BY label`,
      scope.params,
    ),
    query(
      'demographics',
      `SELECT CASE WHEN LOWER(TRIM(c.gender))='male' THEN 'Male' WHEN LOWER(TRIM(c.gender))='female' THEN 'Female' ELSE 'Other / not recorded' END AS label, COUNT(*) AS count FROM cadets c WHERE ${scope.sql} GROUP BY label`,
      scope.params,
    ),
    personal
      ? []
      : query(
          'demographics',
          `SELECT COALESCE(i.institute_name,'Not recorded') AS label, COUNT(*) AS count ${candidateFrom} WHERE ${scope.sql} GROUP BY c.institute_id,i.institute_name ORDER BY count DESC LIMIT 5`,
          scope.params,
        ),
    queue(
      'documents',
      'cd.id, cd.cadet_id, cd.document_name, cd.original_filename, cd.document_type, cd.document_mime_type, cd.created_at, cd.status, (cd.document_data IS NOT NULL OR cd.original_filename IS NOT NULL) AS has_file, cd.external_upload_link, c.name_as_in_indos_cert AS cadet_name, c.drive_id, i.institute_name',
      `${candidateFrom} JOIN cadet_documents cd ON cd.cadet_id=c.id`,
      "cd.status='pending'",
      pages.documents,
      conditions.exists.cadet_documents,
    ),
    personal
      ? { rows: [], total: 0 }
      : queue(
          'ctv',
          `${candidateSelect}, c.imu_avg_all_semester_percentage AS academic_score`,
          candidateFrom,
          conditions.ready,
          pages.ctv,
          conditions.readyAvailable,
        ),
    personal
      ? { rows: [], total: 0 }
      : queue(
          'onboarding',
          `${candidateSelect}, o.id AS onboarding_id, (o.passport_verified+o.medical_cert_verified+o.bank_details_verified+o.agreement_signed+o.final_clearance) AS completed_checks`,
          `${candidateFrom} JOIN onboarding o ON o.cadet_id=c.id JOIN allocations a ON a.id=o.allocation_id JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id`,
          "o.status='Pending' AND c.status='CTV Assigned' AND a.is_active=1 AND ac.deleted_at IS NULL",
          pages.onboarding,
          conditions.exists.onboarding && conditions.allocation,
        ),
    personal
      ? []
      : query(
          'alerts',
          `SELECT i.id,i.institute_name,i.temp_expiry, CASE WHEN i.temp_expiry<NOW() THEN 'expired' ELSE 'expiring_soon' END AS expiry_status FROM institutes i WHERE i.temp_expiry IS NOT NULL ${institute ? '' : 'AND i.temp_expiry<=DATE_ADD(NOW(), INTERVAL 7 DAY)'} ${instituteWhere} ORDER BY i.temp_expiry`,
          instituteParams,
        ),
    personal
      ? []
      : query(
          'filters',
          `SELECT d.id,d.drive_name,d.course_type FROM recruitment_drives d ${institute ? 'WHERE d.institute_id=?' : ''} ORDER BY d.created_at DESC`,
          institute ? [access.instituteId] : [],
        ),
    personal
      ? []
      : query(
          'filters',
          `SELECT DISTINCT c.batch_year FROM cadets c WHERE ${baseScope.sql} AND c.batch_year IS NOT NULL ORDER BY c.batch_year DESC`,
          baseScope.params,
        ),
    institute || personal || !access.canViewFleet
      ? []
      : query(
          'fleet',
          `SELECT COUNT(*) AS activeVessels FROM vessels v WHERE v.status='Active' ${filters.stream && filters.stream !== 'Other' ? "AND v.department IN (?, 'Both')" : ''}`,
          filters.stream && filters.stream !== 'Other' ? [filters.stream] : [],
          conditions.allocation && conditions.exists.vessels,
        ),
    institute || personal || !access.canViewActivity
      ? []
      : query(
          'activity',
          'SELECT id,action,details,UNIX_TIMESTAMP(created_at) AS created_at FROM activity_logs ORDER BY activity_logs.created_at DESC,id DESC LIMIT 6',
          [],
          conditions.exists.activity_logs,
        ),
    institute
      ? query(
          'submissions',
          `SELECT s.status,COUNT(*) AS count FROM institute_submissions s WHERE s.institute_id=? ${filters.driveId ? 'AND s.drive_id=?' : ''} GROUP BY s.status`,
          [access.instituteId, ...(filters.driveId ? [filters.driveId] : [])],
          conditions.exists.institute_submissions,
        )
      : [],
    personal
      ? query(
          'personal',
          `SELECT ${candidateSelect}, c.email_id ${candidateFrom} WHERE ${scope.sql}`,
          scope.params,
        )
      : [],
    personal
      ? query(
          'documents',
          `SELECT cd.id,cd.document_name,cd.document_type,cd.status,cd.admin_remarks,cd.external_upload_link,(cd.document_data IS NOT NULL OR cd.original_filename IS NOT NULL) AS has_file FROM cadet_documents cd JOIN cadets c ON c.id=cd.cadet_id WHERE ${scope.sql} ORDER BY cd.created_at`,
          scope.params,
          conditions.exists.cadet_documents,
        )
      : [],
    personal
      ? query(
          'personal',
          `SELECT v.name AS vessel_name,sv.name AS secondary_vessel_name,a.allocation_status,a.secondary_allocation_status FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id JOIN cadets c ON c.id=a.cadet_id LEFT JOIN vessels v ON v.id=a.vessel_id LEFT JOIN vessels sv ON sv.id=a.secondary_vessel_id WHERE ${scope.sql} AND a.is_active=1 AND ac.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 1`,
          scope.params,
          conditions.allocation && conditions.exists.vessels,
        )
      : [],
  ]);
  const summary = summaryRows[0] || {};
  return {
    generatedAt: new Date().toISOString(),
    filters,
    scope: personal ? 'personal' : institute ? 'institute' : 'global',
    totalCandidates: Number(summary.totalCandidates || 0),
    totalInstitutes: Number(summary.totalInstitutes || 0),
    pipeline: buildPipeline(stages, summary),
    streamDistribution: streams,
    genderDistribution: genders,
    topInstitutes,
    pendingDocuments: docs,
    ctvReadyCandidates: ready,
    onboardingPending: onboarding,
    expiryAlerts: alerts,
    filterOptions: {
      drives,
      batchYears: batches.map((row) => String(row.batch_year)),
    },
    fleet: fleet[0] || null,
    recentActivity: activity.map((row) => ({
      ...row,
      created_at: unixTimestampToIso(row.created_at),
    })),
    submissions,
    personal: personal
      ? {
          candidate: personalRows[0] || null,
          documents: personalDocs,
          assignment: assignment[0] || null,
        }
      : null,
    unavailable: [...unavailable],
  };
};

const getStageCandidates = async (filters, access, stage, page) => {
  if (!stages.some((item) => item.key === stage))
    throw Object.assign(new Error('Invalid pipeline stage'), { status: 400 });
  const conditions = await getConditions();
  const scope = cadetScope(filters, access);
  const where = `${scope.sql} AND (${conditions[stage]})`;
  const [totals] = await db.query(
    `SELECT COUNT(*) AS total FROM cadets c WHERE ${where}`,
    scope.params,
  );
  const [rows] = await db.query(
    `SELECT c.id,c.cadet_unique_id,c.name_as_in_indos_cert,c.course,c.drive_id,c.status,i.institute_name FROM cadets c LEFT JOIN institutes i ON i.id=c.institute_id WHERE ${where} ORDER BY c.name_as_in_indos_cert,c.id LIMIT 10 OFFSET ?`,
    [...scope.params, (page - 1) * 10],
  );
  return { rows, total: Number(totals[0].total), page, pageSize: 10 };
};

module.exports = { getDashboardStats, getStageCandidates, resolveCadetId };
