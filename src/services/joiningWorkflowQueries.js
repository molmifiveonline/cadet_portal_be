const { json, dateOnly, roleFields, unixTimestampToIso } = require('./joiningWorkflowService');

// The filter and displayed badge use the same latest manual response for the current revision.
const latestConfirmation = `(SELECT cm.confirmation_received FROM allocation_communications cm
  WHERE cm.joining_plan_id=jp.id AND cm.plan_revision=jp.revision AND cm.delivery_status IS NULL
  ORDER BY COALESCE(cm.recorded_at,cm.created_at) DESC,cm.id DESC LIMIT 1)`;

const createJoiningWorkflowQueries = (w) => {
  const enrichMany = async (u, allocations) => {
    if (!allocations.length) return [];
    const ids = allocations.map((a) => a.id);
    const [plans] = await w.database.query(
      `SELECT jp.*,
      ${latestConfirmation} AS confirmation_received,
      (SELECT COUNT(*) FROM allocation_communications cm WHERE cm.joining_plan_id=jp.id AND cm.delivery_status='Sent') AS sent_count
      FROM joining_plans jp WHERE jp.allocation_id IN (?)`,
      [ids],
    );
    const [attempts] = await w.database.query(
      `SELECT id,allocation_id,joining_plan_id,plan_revision,status,failure_reason,UNIX_TIMESTAMP(created_at) AS created_epoch
      FROM joining_email_attempts WHERE allocation_id IN (?) ORDER BY created_at DESC,id DESC`,
      [ids],
    );
    const [contacts] = await w.database.query(
      `SELECT cm.*,UNIX_TIMESTAMP(COALESCE(cm.recorded_at,cm.informed_at)) AS informed_epoch,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',u.first_name,u.last_name)),''),u.email) AS informed_by_name
      FROM allocation_communications cm JOIN joining_plans jp ON jp.id=cm.joining_plan_id LEFT JOIN users u ON u.id=cm.informed_by
      WHERE jp.allocation_id IN (?) ORDER BY COALESCE(cm.recorded_at,cm.created_at) DESC,cm.id DESC`,
      [ids],
    );
    const [owners] = await w.database.query(
      "SELECT id,status,COALESCE(NULLIF(TRIM(CONCAT_WS(' ',first_name,last_name)),''),email) AS name FROM users WHERE id IN (?)",
      [allocations.map((a) => a.follow_up_user_id || '')],
    );
    const [vessels] = await w.database.query(
      'SELECT id,name,joining_date,reporting_port FROM vessels WHERE id IN (?)',
      [allocations.flatMap((a) => [a.vessel_id || '', a.secondary_vessel_id || ''])],
    );
    // Explicit projection: assignment access never returns ranks or assessment scores.
    const keys = [
      'id',
      'cadet_id',
      'name_as_in_indos_cert',
      'cadet_unique_id',
      'email_id',
      'department',
      'allocation_number',
      'rank_list_id',
      'onboarding_status',
      'admission_source',
      'vessel_id',
      'vessel_type_id',
      'allocation_status',
      'secondary_vessel_id',
      'secondary_vessel_type_id',
      'secondary_allocation_status',
      'primary_plan_version',
      'secondary_plan_version',
      'follow_up_user_id',
    ];
    return allocations.map((a) => ({
      ...Object.fromEntries(keys.map((k) => [k, a[k]])),
      owner: owners.find((o) => o.id === a.follow_up_user_id) || null,
      vessels: vessels
        .filter((v) => [a.vessel_id, a.secondary_vessel_id].includes(v.id))
        .map((v) => ({ ...v, joining_date: dateOnly(v.joining_date) })),
      abilities: w.abilities(u, a),
      plans: plans
        .filter((p) => p.allocation_id === a.id)
        .map((p) => {
          const f = roleFields(p.vessel_role),
            emails = attempts.filter((e) => e.joining_plan_id === p.id);
          const last = contacts.find(
            (c) => c.joining_plan_id === p.id && c.plan_revision === p.revision && c.delivery_status === null,
          );
          const legacy = contacts.find((c) => c.joining_plan_id === p.id && c.delivery_status);
          const currentSent =
            emails.some((e) => e.plan_revision === p.revision && e.status === 'Sent') ||
            contacts.some(
              (c) =>
                c.joining_plan_id === p.id && c.plan_revision === p.revision && c.delivery_status === 'Sent',
            );
          const everSent = Number(p.sent_count) > 0 || emails.some((e) => e.status === 'Sent');
          return {
            ...p,
            joining_date: dateOnly(p.joining_date),
            required_documents: json(p.required_documents, []),
            allocation_status: a[f.status],
            name_as_in_indos_cert: a.name_as_in_indos_cert,
            cadet_unique_id: a.cadet_unique_id,
            email_id: a.email_id,
            department: a.department,
            confirmation_received: p.confirmation_received || 0,
            email_status: emails[0]?.status || legacy?.delivery_status || null,
            email_failure_reason: emails[0]?.failure_reason || legacy?.failure_reason || null,
            ever_sent: everSent,
            current_email_sent: currentSent,
            updated_email_pending: everSent && !currentSent,
            last_contact: last
              ? {
                  ...last,
                  informed_at: unixTimestampToIso(last.informed_epoch),
                  date_of_informing: dateOnly(last.date_of_informing),
                }
              : null,
          };
        }),
    }));
  };
  const get = async (user, id) => {
    const u = await w.actor(user),
      a = await w.loadAllocation(w.database, id);
    w.requireAbility(u, a, 'can_view');
    return (await enrichMany(u, [a]))[0];
  };
  const list = async (user, query = {}) => {
    const u = await w.actor(user),
      mine = query.mine === 'true' || !u.grants.view;
    const confirmation = query.confirmation ?? 'all';
    if (!['all', 'confirmed', 'pending'].includes(confirmation))
      throw Object.assign(new Error('Select All, Confirmed, or Pending confirmation status'), {
        status: 400,
      });
    const requestedPage = Math.max(1, parseInt(query.page) || 1),
      limit = Math.min(100, Math.max(1, parseInt(query.limit) || 25));
    const params = [],
      conditions = [
        'a.is_active=1',
        "((a.vessel_id IS NOT NULL AND a.allocation_status='Allocated') OR (a.secondary_vessel_id IS NOT NULL AND a.secondary_allocation_status='Allocated'))",
      ];
    if (!query.cycle_id || mine) conditions.push('ac.deleted_at IS NULL');
    if (mine) {
      conditions.push('a.follow_up_user_id=?');
      params.push(u.id);
    }
    if (query.cycle_id) {
      conditions.push('ac.id=?');
      params.push(query.cycle_id);
    }
    if (query.search) {
      conditions.push('(c.name_as_in_indos_cert LIKE ? OR c.cadet_unique_id LIKE ?)');
      params.push(`%${query.search}%`, `%${query.search}%`);
    }
    if (confirmation !== 'all') {
      const pending = ['Primary', 'Secondary']
        .map((role) => {
          const f = roleFields(role);
          return `(a.${f.vessel} IS NOT NULL AND COALESCE(a.${f.status},'Pending')='Allocated'
            AND NOT EXISTS (SELECT 1 FROM joining_plans jp
              WHERE jp.allocation_id=a.id AND jp.vessel_role='${role}'
                AND COALESCE(${latestConfirmation},0)=1))`;
        })
        .join(' OR ');
      conditions.push(confirmation === 'confirmed' ? `NOT (${pending})` : `(${pending})`);
    }
    const from = `FROM allocations a JOIN cadets c ON c.id=a.cadet_id JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id JOIN allocation_cycles ac ON ac.id=rl.cycle_id LEFT JOIN onboarding o ON o.allocation_id=a.id WHERE ${conditions.join(' AND ')}`;
    const [[count]] = await w.database.query(`SELECT COUNT(*) AS total ${from}`, params);
    const totalPages = Math.ceil(count.total / limit);
    const page = Math.min(requestedPage, Math.max(1, totalPages));
    const [allocations] = await w.database.query(
      `SELECT a.*,c.name_as_in_indos_cert,c.cadet_unique_id,c.email_id,rl.department,ac.allocation_number,ac.deleted_at AS cycle_deleted_at,o.status AS onboarding_status,o.admission_source ${from} ORDER BY a.created_at DESC,a.id LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    );
    const data = await enrichMany(u, allocations);
    return {
      data,
      pagination: { page, limit, total: count.total, totalPages },
    };
  };
  const history = async (user, id) => {
    const u = await w.actor(user),
      a = await w.loadAllocation(w.database, id);
    w.requireAbility(u, a, 'can_view');
    const [changes] = await w.database.query(
      'SELECT *,UNIX_TIMESTAMP(created_at) AS epoch FROM allocation_workflow_history WHERE allocation_id=? ORDER BY created_at DESC,id DESC',
      [id],
    );
    const [emails] = await w.database.query(
      'SELECT *,UNIX_TIMESTAMP(created_at) AS epoch FROM joining_email_attempts WHERE allocation_id=? ORDER BY created_at DESC,id DESC',
      [id],
    );
    const [contacts] = await w.database.query(
      `SELECT cm.*,jp.vessel_role,UNIX_TIMESTAMP(COALESCE(cm.recorded_at,cm.informed_at)) AS epoch,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',u.first_name,u.last_name)),''),u.email) AS informed_by_name,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',rec.first_name,rec.last_name)),''),rec.email) AS recorded_by_name
      FROM allocation_communications cm JOIN joining_plans jp ON jp.id=cm.joining_plan_id
      LEFT JOIN users u ON u.id=cm.informed_by LEFT JOIN users rec ON rec.id=cm.recorded_by WHERE jp.allocation_id=?`,
      [id],
    );
    return [
      ...changes.map((r) => ({
        ...r,
        kind: 'change',
        before_snapshot: json(r.before_snapshot),
        after_snapshot: json(r.after_snapshot),
      })),
      ...emails.map(({ html, ...r }) => ({
        ...r,
        kind: 'email',
        snapshot: json(r.snapshot),
        cc: json(r.cc, []),
      })),
      ...contacts.map((r) => ({ ...r, kind: 'contact', date_of_informing: dateOnly(r.date_of_informing) })),
    ]
      .map((r) => ({ ...r, timestamp: unixTimestampToIso(r.epoch) }))
      .sort((a, b) => Number(b.epoch) - Number(a.epoch));
  };
  const lookups = async (user, id) => {
    const u = await w.actor(user),
      a = await w.loadAllocation(w.database, id);
    w.requireAbility(u, a, 'can_view');
    const [vessels] = await w.database.query(
      "SELECT * FROM vessels WHERE (status='Active' AND department IN (?, 'Both')) OR id IN (?,?)",
      [a.department, a.vessel_id, a.secondary_vessel_id],
    );
    const [types] = await w.database.query(
      "SELECT * FROM vessel_types WHERE status='Active' AND department IN (?, 'Both')",
      [a.department],
    );
    return { vessels: vessels.map((v) => ({ ...v, joining_date: dateOnly(v.joining_date) })), types };
  };
  return { get, list, history, lookups };
};
module.exports = { createJoiningWorkflowQueries };
