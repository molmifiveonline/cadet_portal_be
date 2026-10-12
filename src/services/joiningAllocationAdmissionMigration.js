// Runs in the workflow migration transaction. Existing checks and contacts stay intact.
const migrateAllocationAdmissions = async (connection) => {
  const [migration] = await connection.query(
    "INSERT IGNORE INTO allocation_workflow_migrations (name) VALUES ('allocation-onboarding-v2')",
  );
  if (!migration.affectedRows) return;
  const allocated =
    "((a.vessel_id IS NOT NULL AND a.allocation_status='Allocated') OR (a.secondary_vessel_id IS NOT NULL AND a.secondary_allocation_status='Allocated'))";
  const active = `a.is_active=1 AND ac.deleted_at IS NULL AND ${allocated}`;
  await connection.query(`UPDATE allocations a
    JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id
    JOIN cadets c ON c.id=a.cadet_id
    SET a.previous_cadet_status=COALESCE(a.previous_cadet_status,c.status),
      a.previous_workflow_phase=COALESCE(a.previous_workflow_phase,c.workflow_phase),
      a.previous_workflow_result=COALESCE(a.previous_workflow_result,c.workflow_result)
    WHERE ${active} AND c.status<>'Onboarded' AND a.previous_cadet_status IS NULL`);
  await connection.query(`INSERT INTO onboarding (id,cadet_id,allocation_id,status,admission_source,admitted_at)
    SELECT UUID(),a.cadet_id,a.id,'Pending','allocation',CURRENT_TIMESTAMP
    FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
    JOIN allocation_cycles ac ON ac.id=rl.cycle_id JOIN cadets c ON c.id=a.cadet_id
    WHERE ${active} AND c.status<>'Onboarded'
    ON DUPLICATE KEY UPDATE
      admitted_at=IF(admission_source IS NULL,COALESCE(admitted_at,CURRENT_TIMESTAMP),admitted_at),
      admission_source=COALESCE(admission_source,'allocation')`);
  await connection.query(`UPDATE cadets c JOIN allocations a ON a.cadet_id=c.id
    JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id
    JOIN onboarding o ON o.allocation_id=a.id
    SET c.status='CTV Assigned',c.workflow_phase='selected',c.workflow_result='ctv_assigned',c.workflow_updated_at=NOW()
    WHERE ${active} AND o.status='Pending' AND o.admission_source IS NOT NULL AND c.status<>'Onboarded'`);

  // Older assignments may have no plan. Use their current saved master details as
  // a starting revision so both allocated vessels can receive manual follow-ups.
  for (const [role, prefix, version] of [
    ['Primary', '', 'primary_plan_version'],
    ['Secondary', 'secondary_', 'secondary_plan_version'],
  ]) {
    await connection.query(
      `INSERT INTO joining_plans
      (id,allocation_id,vessel_role,vessel_id,revision,status,requires_refresh,vessel_name,vessel_type,
       location,joining_date,total_seats,voyage_ref,reporting_port,contact_person_name,contact_person_email,
       contact_person_phone,communication_details,required_documents)
      SELECT UUID(),a.id,?,v.id,GREATEST(a.${version},1),'Draft',0,v.name,COALESCE(vt.name,v.vessel_type),
       v.location,v.joining_date,v.total_seats,v.voyage_ref,v.reporting_port,v.contact_person_name,
       v.contact_person_email,v.contact_person_phone,NULL,v.required_documents
      FROM allocations a JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
      JOIN allocation_cycles ac ON ac.id=rl.cycle_id JOIN cadets c ON c.id=a.cadet_id
      JOIN vessels v ON v.id=a.${prefix}vessel_id LEFT JOIN vessel_types vt ON vt.id=v.vessel_type_id
      LEFT JOIN joining_plans jp ON jp.allocation_id=a.id AND jp.vessel_role=?
      LEFT JOIN onboarding o ON o.allocation_id=a.id
      WHERE a.is_active=1 AND ac.deleted_at IS NULL AND a.${prefix}allocation_status='Allocated'
        AND jp.id IS NULL AND c.status<>'Onboarded' AND (o.status IS NULL OR o.status<>'Onboarded')`,
      [role, role],
    );
    await connection.query(
      `UPDATE allocations a JOIN joining_plans jp ON jp.allocation_id=a.id AND jp.vessel_role=?
      SET a.${version}=GREATEST(a.${version},jp.revision)`,
      [role],
    );
  }
};
module.exports = { migrateAllocationAdmissions };
