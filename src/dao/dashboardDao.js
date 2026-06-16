const db = require('../config/database');
const { hasColumn, hasTable } = require('../services/schemaCompatibilityService');

// Helper: run a query safely, returning a fallback on error (e.g. missing table)
const safeQuery = async (query, params = [], fallback = []) => {
  try {
    const [rows] = await db.query(query, params);
    return rows;
  } catch (err) {
    console.warn('Dashboard query skipped:', err.sqlMessage || err.message);
    return fallback;
  }
};

const getDashboardStats = async (driveId) => {
  const cadetCompat = await hasColumn('cadets', 'workflow_phase');
  const hasCadetDocuments = await hasTable('cadet_documents');

  const shortlistedCondition = cadetCompat
    ? "c.workflow_phase IN ('shortlisted', 'assessment', 'interview', 'medical', 'selected') OR (c.workflow_phase = 'rejected' AND c.rejection_stage IN ('assessment', 'interview', 'medical', 'selected'))"
    : "c.status IN ('Shortlisted', 'Eligible for Assessment', 'Assessment Passed', 'Assessment Failed', 'Interviewed', 'Eligible for Interview', 'Interview Selected', 'Interview Failed', 'Selected', 'Eligible for Medical', 'Medical Completed', 'Medical Failed', 'CTV Assigned', 'Onboarded')";

  const medicalQueueCondition = cadetCompat
    ? `(c.workflow_phase = 'medical'
        OR c.status IN ('Selected', 'Eligible for Medical', 'Interview Selected', 'Medical Completed', 'Medical Failed')
        OR EXISTS (
          SELECT 1
          FROM interviews iv
          WHERE iv.cadet_id = c.id
            AND LOWER(COALESCE(iv.final_decision, '')) IN ('selected', 'pass')
        )
        OR EXISTS (
          SELECT 1
          FROM cadet_medical_results mr
          WHERE mr.cadet_id = c.id
        ))`
    : "c.status IN ('Selected', 'Eligible for Medical', 'Interview Selected', 'Medical Completed', 'Medical Failed')";

  const documentCondition = hasCadetDocuments
    ? "(c.workflow_result IN ('medical_passed', 'ctv_assigned', 'onboarded') OR c.status IN ('Selected', 'CTV Assigned', 'Onboarded'))"
    : "0";

  let stageQuery = `
    SELECT 
      COALESCE(SUM(1), 0) AS \`Cadets\`,
      COALESCE(SUM(CASE WHEN ${shortlistedCondition} THEN 1 ELSE 0 END), 0) AS \`Shortlisted\`,
      COALESCE(SUM(CASE WHEN EXISTS (
        SELECT 1 FROM assessments a WHERE a.cadet_id = c.id AND LOWER(COALESCE(a.status, '')) = 'pass'
      ) THEN 1 ELSE 0 END), 0) AS \`Assessment\`,
      COALESCE(SUM(CASE WHEN EXISTS (
        SELECT 1 FROM interviews iv WHERE iv.cadet_id = c.id AND LOWER(COALESCE(iv.final_decision, '')) = 'selected'
      ) THEN 1 ELSE 0 END), 0) AS \`Interview\`,
      COALESCE(SUM(CASE WHEN ${medicalQueueCondition} THEN 1 ELSE 0 END), 0) AS \`Medical\`,
      COALESCE(SUM(CASE WHEN ${documentCondition} THEN 1 ELSE 0 END), 0) AS \`Documents\`
    FROM cadets c
  `;

  const queryParams = [];
  if (driveId && driveId !== 'all') {
    stageQuery += ' WHERE c.drive_id = ?';
    queryParams.push(driveId);
  }

  // Run all queries in parallel — each is independently safe
  const [
    totalInstitutesRows,
    totalCandidatesRows,
    genderCountRows,
    stageWiseRawRows,
    pendingDocsRows,
    ctvReadyRows,
    onboardingPendingRows,
    expiryAlertsRows,
  ] = await Promise.all([
    // 1. Total Institutes
    safeQuery('SELECT COUNT(*) as total FROM institutes', [], [{ total: 0 }]),

    // 2. Total Candidates
    safeQuery('SELECT COUNT(*) as total FROM cadets', [], [{ total: 0 }]),

    // 2b. Gender Counts
    safeQuery(
      `SELECT 
        SUM(CASE WHEN LOWER(gender) = 'male' OR gender IS NULL OR gender = '' THEN 1 ELSE 0 END) as maleCount,
        SUM(CASE WHEN LOWER(gender) = 'female' THEN 1 ELSE 0 END) as femaleCount
       FROM cadets`,
      [],
      [{ maleCount: 0, femaleCount: 0 }]
    ),

    // 3. Stage-wise Candidate Count (using computed fields mapped to 6 stages)
    safeQuery(stageQuery, queryParams),

    // 4. Pending Documents (with cadet name)
    safeQuery(
      `SELECT 
        cd.id, cd.cadet_id, cd.document_name, cd.document_type, 
        cd.status, cd.created_at,
        c.name_as_in_indos_cert as cadet_name,
        i.institute_name
       FROM cadet_documents cd
       LEFT JOIN cadets c ON cd.cadet_id = c.id
       LEFT JOIN institutes i ON c.institute_id = i.id
       WHERE cd.status = 'pending'
       ORDER BY cd.created_at DESC
       LIMIT 50`,
    ),

    // 5. Candidates Ready for CTV (stage = 'selected')
    safeQuery(
      `SELECT 
        c.id, c.cadet_unique_id, c.name_as_in_indos_cert, c.email_id, 
        c.contact_number, c.course, c.status,
        i.institute_name
       FROM cadets c
       LEFT JOIN institutes i ON c.institute_id = i.id
       WHERE c.status = 'selected'
       ORDER BY c.created_at DESC
       LIMIT 50`,
    ),

    // 6. Onboarding Pending (selected but not joined)
    safeQuery(
      `SELECT 
        c.id, c.cadet_unique_id, c.name_as_in_indos_cert, c.email_id, 
        c.contact_number, c.course, c.status,
        i.institute_name
       FROM cadets c
       LEFT JOIN institutes i ON c.institute_id = i.id
       WHERE c.status IN ('selected', 'standby')
       ORDER BY c.created_at DESC
       LIMIT 50`,
    ),

    // 7. Alerts & Expiry — credentials expiring within 7 days or already expired
    safeQuery(
      `SELECT 
        id, institute_name, temp_username, temp_expiry,
        CASE 
          WHEN temp_expiry < NOW() THEN 'expired'
          WHEN temp_expiry <= DATE_ADD(NOW(), INTERVAL 7 DAY) THEN 'expiring_soon'
          ELSE 'active'
        END as expiry_status
       FROM institutes
       WHERE temp_expiry IS NOT NULL 
         AND temp_expiry <= DATE_ADD(NOW(), INTERVAL 7 DAY)
       ORDER BY temp_expiry ASC`,
    ),
  ]);

  const stageRow = stageWiseRawRows[0] || {};
  const stageWiseRows = [
    { stage: 'Cadets', count: Number(stageRow.Cadets || 0) },
    { stage: 'Shortlisted', count: Number(stageRow.Shortlisted || 0) },
    { stage: 'Assessment', count: Number(stageRow.Assessment || 0) },
    { stage: 'Interview', count: Number(stageRow.Interview || 0) },
    { stage: 'Medical', count: Number(stageRow.Medical || 0) },
    { stage: 'Documents', count: Number(stageRow.Documents || 0) },
  ];

  return {
    totalInstitutes: totalInstitutesRows[0]?.total ?? 0,
    totalCandidates: totalCandidatesRows[0]?.total ?? 0,
    maleCount: genderCountRows[0]?.maleCount ?? 0,
    femaleCount: genderCountRows[0]?.femaleCount ?? 0,
    stageWiseCounts: stageWiseRows,
    pendingDocuments: pendingDocsRows,
    ctvReadyCandidates: ctvReadyRows,
    onboardingPending: onboardingPendingRows,
    expiryAlerts: expiryAlertsRows,
  };
};

module.exports = {
  getDashboardStats,
};
