const db = require('../config/database');
const { v4: uuid } = require('uuid');
const emailService = require('./emailService');
const rolePermissionDao = require('../dao/rolePermissionDao');
const activityLogDao = require('../dao/activityLogDao');
const { isDepartmentCompatible } = require('./allocationRules');
const { normalizeEmailRecipients } = require('../utils/emailUtils');
const { unixTimestampToIso } = require('../utils/dateUtils');

const fail = (status, message) => Object.assign(new Error(message), { status });
const json = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const dateOnly = (value) =>
  value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value || '').slice(0, 10);
const indiaToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const validDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const text = (value) => String(value ?? '').trim();
const nameOf = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;
const roleFields = (role) => {
  if (!['Primary', 'Secondary'].includes(role)) throw fail(400, 'Select Primary or Secondary');
  const prefix = role === 'Primary' ? '' : 'secondary_';
  return {
    vessel: `${prefix}vessel_id`,
    type: `${prefix}vessel_type_id`,
    status: `${prefix}allocation_status`,
    version: role === 'Primary' ? 'primary_plan_version' : 'secondary_plan_version',
  };
};
const hasAllocatedVessel = (a) =>
  Boolean(
    (a.vessel_id && a.allocation_status === 'Allocated') ||
    (a.secondary_vessel_id && a.secondary_allocation_status === 'Allocated'),
  );
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const emailContent = (plan, cadet, updated) => ({
  subject: `${updated ? 'Updated Joining Intimation' : 'Joining Intimation'} – MOLMI`,
  html: `<p>Dear ${escape(cadet)},</p><p>${updated ? 'Your joining details have been updated. Please use the details below.' : 'Please find your joining details below.'}</p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;max-width:650px;width:100%">${[
      ['Vessel Name', plan.vessel_name],
      ['Vessel Assignment', plan.vessel_role],
      ['Vessel Type', plan.vessel_type],
      ['Joining Date', dateOnly(plan.joining_date)],
      ['Reporting Location', plan.reporting_port],
      ['Vessel Location', plan.location],
      ['Voyage Reference', plan.voyage_ref],
      ['Required Documents', json(plan.required_documents, []).join(', ') || 'None specified'],
      ['Contact Person', plan.contact_person_name],
      ['Contact Phone', plan.contact_person_phone],
      ['Contact Email', plan.contact_person_email],
      ['Reporting Instructions', plan.communication_details],
    ]
      .map(
        ([label, value]) =>
          `<tr><th align="left">${label}</th><td style="white-space:pre-wrap">${escape(value || '-')}</td></tr>`,
      )
      .join('')}</table>
    <p>Please confirm your availability with the MOLMI team.</p><p>Best regards,<br>MOLMI Administration</p>`,
});

const createJoiningWorkflow = ({
  database = db,
  sendEmail = (options) => emailService.sendEmail(options),
  permission = (...args) => rolePermissionDao.userHasPermission(...args),
  log = (...args) => activityLogDao.createLog(...args),
} = {}) => {
  const transaction = async (fn) => {
    const c = await database.getConnection();
    try {
      await c.beginTransaction();
      const result = await fn(c);
      await c.commit();
      return result;
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  };
  const actor = async (user) => {
    const [[u]] = await database.query(
      'SELECT id,email,first_name,last_name,role,status FROM users WHERE id=?',
      [user?.id || ''],
    );
    if (!u || u.status !== 'active' || ['cadet', 'institute'].includes(u.role.toLowerCase()))
      throw fail(403, 'Active internal user access is required');
    const grants = {};
    for (const action of ['view', 'edit', 'communicate', 'send-intimation', 'assign-followup'])
      grants[action] =
        u.role.toLowerCase() === 'superadmin' || (await permission(u.role, 'allocations', action));
    return { ...u, grants };
  };
  const loadAllocation = async (c, id, lock = false) => {
    const [[a]] = await c.query(
      `SELECT a.*,c.name_as_in_indos_cert,c.cadet_unique_id,c.email_id,c.status AS cadet_status,
      c.workflow_phase,c.workflow_result,rl.department,rl.status AS list_status,ac.allocation_number,ac.deleted_at AS cycle_deleted_at,
      o.status AS onboarding_status,o.admission_source
      FROM allocations a JOIN cadets c ON c.id=a.cadet_id JOIN allocation_rank_lists rl ON rl.id=a.rank_list_id
      JOIN allocation_cycles ac ON ac.id=rl.cycle_id LEFT JOIN onboarding o ON o.allocation_id=a.id
      WHERE a.id=? ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    if (!a) throw fail(404, 'Candidate allocation not found');
    return a;
  };
  const abilities = (u, a) => {
    const owned = a.follow_up_user_id === u.id;
    const writable = !a.cycle_deleted_at && Number(a.is_active) === 1 && a.onboarding_status !== 'Onboarded';
    return {
      can_view: Boolean(
        u.grants.view ||
        u.grants.edit ||
        u.grants.communicate ||
        u.grants['send-intimation'] ||
        u.grants['assign-followup'] ||
        owned,
      ),
      can_edit: writable && Boolean(u.grants.edit || owned),
      can_follow: writable && Boolean(u.grants.communicate || owned),
      can_send: writable && Boolean(u.grants['send-intimation']),
      can_assign: writable && Boolean(u.grants['assign-followup']),
      can_choose_informed_by: false,
    };
  };
  const requireAbility = (u, a, key) => {
    if (!abilities(u, a)[key])
      throw fail(
        a.cycle_deleted_at || a.onboarding_status === 'Onboarded' ? 409 : 403,
        a.cycle_deleted_at
          ? 'Disabled allocations are read-only'
          : a.onboarding_status === 'Onboarded'
            ? 'Completed onboarding records are locked'
            : 'Access denied for this allocation',
      );
  };
  const history = (c, u, a, type, role, before, after, reason, revision) =>
    c.query(
      `INSERT INTO allocation_workflow_history
    (id,allocation_id,event_type,vessel_role,revision,previous_vessel_id,vessel_id,before_snapshot,after_snapshot,reason,actor_id,actor_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuid(),
        a.id,
        type,
        role,
        revision || null,
        before?.vessel_id || null,
        after?.vessel_id || null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        reason || null,
        u.id,
        nameOf(u),
      ],
    );
  const activity = (c, u, a, action, detail) =>
    log(
      u.id,
      action,
      `${a.name_as_in_indos_cert} (${a.cadet_unique_id}) in ${a.allocation_number}: ${detail}`,
      null,
      c,
    );
  const normalizePlan = (p) =>
    p
      ? { ...p, joining_date: dateOnly(p.joining_date), required_documents: json(p.required_documents, []) }
      : null;
  const getPlan = async (c, a, role) => {
    const [[p]] = await c.query('SELECT * FROM joining_plans WHERE allocation_id=? AND vessel_role=?', [
      a.id,
      role,
    ]);
    return normalizePlan(p);
  };
  const snapshot = (a, role, p, v = {}) => {
    const f = roleFields(role);
    return {
      vessel_id: a[f.vessel] || null,
      vessel_type_id: a[f.type] || null,
      allocation_status: a[f.status],
      vessel_name: p?.vessel_name || v.name || null,
      vessel_type: p?.vessel_type || v.vessel_type || null,
      joining_date: dateOnly(p ? p.joining_date : v.joining_date),
      location: p ? p.location : v.location || null,
      total_seats: p ? p.total_seats : (v.total_seats ?? null),
      voyage_ref: p ? p.voyage_ref : v.voyage_ref || null,
      reporting_port: p ? p.reporting_port : v.reporting_port || null,
      contact_person_name: p ? p.contact_person_name : v.contact_person_name || null,
      contact_person_email: p ? p.contact_person_email : v.contact_person_email || null,
      contact_person_phone: p ? p.contact_person_phone : v.contact_person_phone || null,
      communication_details: p?.communication_details || null,
      required_documents: json(p ? p.required_documents : v.required_documents, []),
    };
  };
  const syncCadet = async (c, a) => {
    const [[o]] = await c.query('SELECT admission_source,status FROM onboarding WHERE allocation_id=?', [
      a.id,
    ]);
    if (o?.status === 'Onboarded') return;
    const allocated =
      (a.vessel_id && a.allocation_status === 'Allocated') ||
      (a.secondary_vessel_id && a.secondary_allocation_status === 'Allocated');
    const admitted = o?.admission_source && allocated;
    if (!o?.admission_source) return;
    await c.query(
      `UPDATE cadets SET status=?,workflow_phase=?,workflow_result=?,workflow_updated_at=NOW() WHERE id=?`,
      [
        admitted ? 'CTV Assigned' : a.previous_cadet_status || 'Selected',
        admitted ? 'selected' : a.previous_workflow_phase || 'selected',
        admitted ? 'ctv_assigned' : a.previous_workflow_result,
        a.cadet_id,
      ],
    );
  };
  // Allocation, rather than email delivery, admits a cadet to onboarding.
  const admitAllocation = async (c, a) => {
    if (!hasAllocatedVessel(a) || a.cycle_deleted_at || Number(a.is_active) !== 1) return;
    await c.query(
      'UPDATE allocations SET previous_cadet_status=COALESCE(previous_cadet_status,?),previous_workflow_phase=COALESCE(previous_workflow_phase,?),previous_workflow_result=COALESCE(previous_workflow_result,?) WHERE id=? AND previous_cadet_status IS NULL',
      [a.cadet_status, a.workflow_phase, a.workflow_result, a.id],
    );
    await c.query(
      `INSERT INTO onboarding (id,cadet_id,allocation_id,status,admission_source,admitted_at)
      VALUES (?,?,?,'Pending','allocation',CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE
      admitted_at=IF(admission_source IS NULL,COALESCE(admitted_at,CURRENT_TIMESTAMP),admitted_at),admission_source=COALESCE(admission_source,'allocation')`,
      [uuid(), a.cadet_id, a.id],
    );
    a.admission_source ||= 'allocation';
  };
  const saveInTransaction = async (c, u, a, body) => {
    requireAbility(u, a, 'can_edit');
    const role = body.vessel_role;
    const f = roleFields(role);
    if (!Number.isInteger(body.expected_version) || body.expected_version !== Number(a[f.version]))
      throw fail(409, 'Allocation changed. Reload before saving.');
    const [[sending]] = await c.query(
      "SELECT id FROM joining_email_attempts WHERE allocation_id=? AND status='Sending' LIMIT 1",
      [a.id],
    );
    if (sending)
      throw fail(
        409,
        'An email send is in progress or awaiting delivery review. Check History before changing this allocation.',
      );
    const status = body.allocation_status || 'Pending';
    if (!['Pending', 'Allocated', 'Hold', 'Cancelled'].includes(status))
      throw fail(400, 'Invalid allocation status');
    const vesselId = body.vessel_id || null;
    if (['Allocated', 'Hold'].includes(status) && !vesselId)
      throw fail(400, 'Allocated and Hold require an actual vessel');
    if (vesselId && vesselId === a[roleFields(role === 'Primary' ? 'Secondary' : 'Primary').vessel])
      throw fail(400, 'Primary and Secondary must be different vessels');
    let v = {};
    if (vesselId) {
      const [[found]] = await c.query(
        `SELECT v.*,vt.name AS type_name,vt.status AS type_status,vt.department AS type_department
        FROM vessels v LEFT JOIN vessel_types vt ON vt.id=v.vessel_type_id WHERE v.id=? FOR UPDATE`,
        [vesselId],
      );
      if (
        !found ||
        found.status !== 'Active' ||
        found.type_status !== 'Active' ||
        !isDepartmentCompatible(a.department, found.department) ||
        !isDepartmentCompatible(a.department, found.type_department)
      )
        throw fail(400, 'Select an active vessel and type compatible with this department');
      v = found;
    }
    const p = await getPlan(c, a, role);
    let oldVessel = {};
    if (a[f.vessel]) {
      const [[old]] = await c.query('SELECT * FROM vessels WHERE id=?', [a[f.vessel]]);
      oldVessel = old || {};
    }
    const before = snapshot(a, role, p, oldVessel);
    const same = vesselId === a[f.vessel];
    const details = body.joining_details || {};
    const next = {
      ...snapshot(
        { ...a, [f.vessel]: vesselId, [f.type]: v.vessel_type_id || null, [f.status]: status },
        role,
        same ? p : null,
        v,
      ),
      vessel_name: v.name || null,
      vessel_type: v.type_name || v.vessel_type || null,
    };
    const limits = {
      location: 255,
      joining_date: 10,
      voyage_ref: 100,
      reporting_port: 255,
      contact_person_name: 150,
      contact_person_email: 255,
      contact_person_phone: 50,
      communication_details: 10000,
    };
    for (const [key, max] of Object.entries(limits))
      if (Object.hasOwn(details, key)) {
        const val = text(details[key]);
        if (val.length > max) throw fail(400, `${key.replaceAll('_', ' ')} is too long`);
        next[key] = val || (key === 'joining_date' ? '' : null);
      }
    if (Object.hasOwn(details, 'required_documents')) {
      const docs = details.required_documents;
      if (
        !Array.isArray(docs) ||
        docs.length > 100 ||
        docs.some((d) => typeof d !== 'string' || d.length > 500)
      )
        throw fail(400, 'Enter a valid required document list');
      next.required_documents = docs.map(text).filter(Boolean);
    }
    if (next.joining_date && !validDate(next.joining_date)) throw fail(400, 'Enter a valid joining date');
    if (next.contact_person_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.contact_person_email))
      throw fail(400, 'Enter a valid contact email');
    const changed = JSON.stringify(before) !== JSON.stringify(next);
    const reason = text(body.change_reason);
    if (
      changed &&
      a[f.vessel] &&
      (before.vessel_id !== next.vessel_id || before.joining_date !== next.joining_date) &&
      !reason
    )
      throw fail(400, 'Reason for Change is required when changing a saved vessel or joining date');
    if (reason.length > 4000) throw fail(400, 'Reason for Change must be 4000 characters or fewer');
    if (!changed && p && !Number(p.requires_refresh) && p.vessel_id === vesselId) {
      await admitAllocation(c, a);
      await syncCadet(c, a);
      return { plan: p, version: Number(a[f.version]) };
    }
    const version = Number(a[f.version]) + 1;
    await c.query(
      `UPDATE allocations SET ${f.vessel}=?,${f.type}=?,${f.status}=?,${f.version}=? WHERE id=?`,
      [vesselId, next.vessel_type_id, status, version, a.id],
    );
    const planId = p?.id || uuid();
    if (vesselId || p)
      await c.query(
        `INSERT INTO joining_plans
      (id,allocation_id,vessel_role,vessel_id,revision,status,requires_refresh,vessel_name,vessel_type,location,joining_date,total_seats,voyage_ref,reporting_port,
       contact_person_name,contact_person_email,contact_person_phone,communication_details,required_documents,created_by)
      VALUES (?,?,?,?,?,'Draft',0,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE vessel_id=VALUES(vessel_id),revision=VALUES(revision),status='Draft',requires_refresh=0,
       vessel_name=VALUES(vessel_name),vessel_type=VALUES(vessel_type),location=VALUES(location),joining_date=VALUES(joining_date),total_seats=VALUES(total_seats),
       voyage_ref=VALUES(voyage_ref),reporting_port=VALUES(reporting_port),contact_person_name=VALUES(contact_person_name),contact_person_email=VALUES(contact_person_email),
       contact_person_phone=VALUES(contact_person_phone),communication_details=VALUES(communication_details),required_documents=VALUES(required_documents)`,
        [
          planId,
          a.id,
          role,
          vesselId,
          version,
          next.vessel_name || 'No vessel selected',
          next.vessel_type,
          next.location,
          next.joining_date || null,
          next.total_seats,
          next.voyage_ref,
          next.reporting_port,
          next.contact_person_name,
          next.contact_person_email,
          next.contact_person_phone,
          next.communication_details,
          JSON.stringify(next.required_documents),
          u.id,
        ],
      );
    await history(c, u, a, 'PlanChanged', role, before, next, reason, version);
    await activity(
      c,
      u,
      a,
      'UPDATE_CTV_VESSEL_PLAN',
      `${role} vessel: ${before.vessel_name || '-'} to ${next.vessel_name || '-'}; joining date: ${before.joining_date || '-'} to ${next.joining_date || '-'}; reason: ${reason || 'Initial allocation / joining details updated'}`,
    );
    a[f.vessel] = vesselId;
    a[f.type] = next.vessel_type_id;
    a[f.status] = status;
    a[f.version] = version;
    await admitAllocation(c, a);
    await syncCadet(c, a);
    return { plan: await getPlan(c, a, role), version };
  };
  const save = async (user, id, body) => {
    const u = await actor(user);
    return transaction(async (c) => {
      const a = await loadAllocation(c, id, true);
      const ownerIncluded = Object.hasOwn(body, 'follow_up_user_id');
      if (ownerIncluded) {
        requireAbility(u, a, 'can_assign');
        if (!Object.hasOwn(body, 'expected_follow_up_user_id'))
          throw fail(400, 'The saved follow-up person is required before changing assignment');
        checkOwnerVersion(a, body);
        if (a.follow_up_user_id && a.follow_up_user_id !== body.follow_up_user_id)
          throw fail(409, 'Use Reassign Follow-up Person to transfer or remove responsibility');
      }
      const result = await saveInTransaction(c, u, a, body);
      if (ownerIncluded)
        await assignInTransaction(c, u, a, body.follow_up_user_id || null, 'Saved with vessel allocation');
      return result;
    });
  };
  const informedFields = async (c, u, body, allowOther) => {
    const date = text(body.date_of_informing);
    if (!validDate(date) || date > indiaToday())
      throw fail(400, 'Date of Informing must be a valid date on or before today in India');
    const id = body.informed_by || u.id;
    if (!allowOther && id !== u.id) throw fail(403, 'Record your own contact as the assigned follow-up user');
    const [[person]] = await c.query(
      "SELECT id FROM users WHERE id=? AND status='active' AND LOWER(role) NOT IN ('cadet','institute')",
      [id],
    );
    if (!person)
      throw fail(
        400,
        'The assigned follow-up person is inactive or unavailable. Reassign to an active user.',
      );
    return { date, id };
  };
  const allocationForPlan = async (planId) => {
    const [[p]] = await database.query('SELECT allocation_id FROM joining_plans WHERE id=?', [planId]);
    if (!p) throw fail(404, 'Joining plan not found');
    return p.allocation_id;
  };
  const record = async (user, planId, body) => {
    const u = await actor(user);
    const allocationId = await allocationForPlan(planId);
    return transaction(async (c) => {
      const a = await loadAllocation(c, allocationId, true);
      requireAbility(u, a, 'can_follow');
      const [[plan]] = await c.query('SELECT * FROM joining_plans WHERE id=?', [planId]);
      if (Number(body.expected_revision) !== Number(plan.revision))
        throw fail(409, 'Joining details changed. Reload before recording contact.');
      if (Number(plan.requires_refresh)) throw fail(409, 'Save the current joining details first');
      if (!['Email', 'Phone', 'WhatsApp'].includes(body.mode))
        throw fail(400, 'Select Email, Phone, or WhatsApp');
      if ([body.candidate_remarks, body.admin_remarks].some((value) => text(value).length > 10000))
        throw fail(400, 'Remarks must be 10000 characters or fewer');
      if (![true, false, 0, 1].includes(body.confirmation_received))
        throw fail(400, 'Confirmation Received must be Yes or No');
      const f = roleFields(plan.vessel_role);
      if (!a[f.vessel] || a[f.status] !== 'Allocated' || plan.vessel_id !== a[f.vessel])
        throw fail(409, 'Follow-ups require a current Allocated vessel');
      const informed = await followupFields(c, u, a, body);
      const id = uuid();
      await c.query(
        `INSERT INTO allocation_communications
        (id,joining_plan_id,plan_revision,informed_by,recorded_by,date_of_informing,mode,confirmation_received,candidate_remarks,admin_remarks,recorded_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))`,
        [
          id,
          planId,
          plan.revision,
          informed.id,
          u.id,
          informed.date,
          body.mode,
          body.confirmation_received ? 1 : 0,
          text(body.candidate_remarks) || null,
          text(body.admin_remarks) || null,
        ],
      );
      await c.query('UPDATE joining_plans SET status=? WHERE id=?', [
        body.confirmation_received ? 'Confirmed' : 'Informed',
        planId,
      ]);
      await activity(
        c,
        u,
        a,
        'RECORD_CTV_COMMUNICATION',
        `Recorded ${body.mode} follow-up for ${plan.vessel_role} revision ${plan.revision}; confirmed: ${body.confirmation_received ? 'Yes' : 'No'}`,
      );
      return { id, delivery_status: null };
    });
  };
  const assignInTransaction = async (c, u, a, userId, remarks) => {
    requireAbility(u, a, 'can_assign');
    const hasVessel = ['Primary', 'Secondary'].some((role) => {
      const f = roleFields(role);
      return a[f.vessel] && ['Allocated', 'Hold', 'Cancelled'].includes(a[f.status]);
    });
    if (!hasVessel && !a.admission_source)
      throw fail(
        409,
        'Save a vessel as Allocated, Hold or Cancelled before assigning follow-up responsibility',
      );
    let owner = null;
    if (userId) {
      [[owner]] = await c.query(
        "SELECT id,email,first_name,last_name FROM users WHERE id=? AND status='active' AND LOWER(role) NOT IN ('cadet','institute')",
        [userId],
      );
      if (!owner) throw fail(400, 'Select an active user from User Management');
    }
    if ((a.follow_up_user_id || null) === userId) return { user_id: userId };
    const [[previous]] = await c.query('SELECT id,email,first_name,last_name FROM users WHERE id=?', [
      a.follow_up_user_id || '',
    ]);
    await c.query(
      'UPDATE allocations SET follow_up_user_id=?,follow_up_assigned_by=?,follow_up_assigned_at=CURRENT_TIMESTAMP WHERE id=?',
      [userId, u.id, a.id],
    );
    await history(
      c,
      u,
      a,
      a.follow_up_user_id ? (userId ? 'Reassigned' : 'Unassigned') : 'Assigned',
      null,
      { user_id: a.follow_up_user_id, name: previous ? nameOf(previous) : null },
      { user_id: userId, name: owner ? nameOf(owner) : null },
      text(remarks),
      null,
    );
    await activity(
      c,
      u,
      a,
      'ASSIGN_CTV_FOLLOWUP',
      `Follow-up responsibility: ${previous ? nameOf(previous) : 'Unassigned'} to ${owner ? nameOf(owner) : 'Unassigned'}${remarks ? `; reason: ${text(remarks)}` : ''}`,
    );
    a.follow_up_user_id = userId;
    return { user_id: userId };
  };
  const checkOwnerVersion = (a, body) => {
    if (
      Object.hasOwn(body, 'expected_follow_up_user_id') &&
      (body.expected_follow_up_user_id || null) !== (a.follow_up_user_id || null)
    )
      throw fail(409, 'Follow-up person changed. Reload before saving.');
  };
  const assign = async (user, id, body) => {
    const u = await actor(user);
    return transaction(async (c) => {
      const a = await loadAllocation(c, id, true);
      requireAbility(u, a, 'can_assign');
      if (!Object.hasOwn(body, 'expected_follow_up_user_id'))
        throw fail(400, 'Reload the current follow-up assignment before saving');
      checkOwnerVersion(a, body);
      const next = body.user_id || null;
      if (next === (a.follow_up_user_id || null))
        throw fail(400, 'Select a different follow-up person or remove the assignment');
      if (text(body.remarks).length > 4000 || (a.follow_up_user_id && text(body.remarks).length < 3))
        throw fail(400, 'Enter a reason for reassignment (3 to 4000 characters)');
      return assignInTransaction(c, u, a, next, body.remarks);
    });
  };
  // Informed By is the responsible follow-up person; recorded_by remains the authenticated actor.
  const followupFields = async (c, u, a, body) => {
    if (!a.follow_up_user_id)
      throw fail(409, 'Assign a follow-up person before recording contact or sending a joining email');
    if (body.informed_by !== a.follow_up_user_id)
      throw fail(
        409,
        'Follow-up person changed. Reload the form. Use Reassign Follow-up Person to transfer responsibility.',
      );
    return informedFields(c, u, { ...body, informed_by: a.follow_up_user_id }, true);
  };
  const staff = async (user) => {
    const u = await actor(user);
    if (!u.grants.communicate && !u.grants['send-intimation'] && !u.grants['assign-followup'])
      return [{ id: u.id, name: nameOf(u), role: u.role, email: u.email }];
    const [rows] = await database.query(
      "SELECT id,email,first_name,last_name,role FROM users WHERE status='active' AND LOWER(role) NOT IN ('cadet','institute') ORDER BY first_name,last_name,email",
    );
    return rows.map((r) => ({ ...r, name: nameOf(r) }));
  };
  return {
    save,
    record,
    assign,
    staff,
    actor,
    abilities,
    requireAbility,
    loadAllocation,
    getPlan,
    transaction,
    activity,
    informedFields,
    followupFields,
    allocationForPlan,
    database,
    sendEmail,
    syncCadet,
    saveInTransaction,
  };
};

module.exports = {
  createJoiningWorkflow,
  fail,
  json,
  dateOnly,
  indiaToday,
  validDate,
  emailContent,
  roleFields,
  hasAllocatedVessel,
  normalizeEmailRecipients,
  unixTimestampToIso,
};
