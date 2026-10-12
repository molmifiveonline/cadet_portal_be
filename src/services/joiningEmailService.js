const { v4: uuid } = require('uuid');
const {
  fail,
  emailContent,
  roleFields,
  normalizeEmailRecipients,
  dateOnly,
  json,
} = require('./joiningWorkflowService');

const createJoiningEmailService = (w) => {
  const eligible = (u, a, p, revision) => {
    w.requireAbility(u, a, 'can_send');
    if (Number(revision) !== Number(p.revision))
      throw fail(409, 'Joining details changed. Reload before sending.');
    const f = roleFields(p.vessel_role);
    if (
      !a[f.vessel] ||
      p.vessel_id !== a[f.vessel] ||
      a[f.status] !== 'Allocated' ||
      Number(p.requires_refresh)
    )
      throw fail(409, 'Save the current Allocated vessel and joining details before sending');
    if (!p.joining_date || !p.reporting_port || !p.contact_person_name)
      throw fail(400, 'Joining Date, Reporting Port and Contact Person are required before sending');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email_id || ''))
      throw fail(400, 'The cadet needs a valid saved email address');
  };
  const content = async (c, a, p) => {
    const [[prior]] = await c.query(
      "SELECT id FROM joining_email_attempts WHERE joining_plan_id=? AND status='Sent' AND plan_revision<? LIMIT 1",
      [p.id, p.revision],
    );
    const [[legacy]] = await c.query(
      "SELECT id FROM allocation_communications WHERE joining_plan_id=? AND delivery_status='Sent' AND plan_revision<? LIMIT 1",
      [p.id, p.revision],
    );
    return emailContent(p, a.name_as_in_indos_cert, Boolean(prior || legacy));
  };
  const preview = async (user, planId, revision) => {
    const u = await w.actor(user),
      allocationId = await w.allocationForPlan(planId);
    const a = await w.loadAllocation(w.database, allocationId);
    const [[p]] = await w.database.query('SELECT * FROM joining_plans WHERE id=?', [planId]);
    eligible(u, a, p, revision);
    const [[owner]] = await w.database.query(
      'SELECT first_name,last_name,email,status FROM users WHERE id=?',
      [a.follow_up_user_id || ''],
    );
    return {
      ...(await content(w.database, a, p)),
      recipient_email: a.email_id,
      plan_revision: p.revision,
      allocation_id: a.id,
      follow_up_user_id: a.follow_up_user_id,
      follow_up_user_name: owner
        ? [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email
        : null,
      follow_up_user_status: owner?.status || null,
    };
  };
  const send = async (user, planId, body) => {
    const u = await w.actor(user),
      allocationId = await w.allocationForPlan(planId);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(body.request_key || ''))
      throw fail(400, 'A valid send request identifier is required');
    let cc;
    try {
      cc = normalizeEmailRecipients(body.cc);
    } catch (e) {
      throw fail(400, e.message);
    }
    const attempt = await w.transaction(async (c) => {
      const a = await w.loadAllocation(c, allocationId, true);
      w.requireAbility(u, a, 'can_send');
      const [[existing]] = await c.query('SELECT * FROM joining_email_attempts WHERE request_key=?', [
        body.request_key,
      ]);
      if (existing) {
        if (existing.recorded_by !== u.id || existing.joining_plan_id !== planId)
          throw fail(409, 'Send request identifier is already in use');
        return { ...existing, replay: true };
      }
      const [[p]] = await c.query('SELECT * FROM joining_plans WHERE id=?', [planId]);
      eligible(u, a, p, body.expected_revision);
      const [[pending]] = await c.query(
        "SELECT id FROM joining_email_attempts WHERE joining_plan_id=? AND status IN ('Sending','Unknown') LIMIT 1",
        [planId],
      );
      if (pending)
        throw fail(
          409,
          'A previous email is pending or its delivery is uncertain. Review History; it will not be resent automatically.',
        );
      const informed = await w.followupFields(c, u, a, body);
      const rendered = await content(c, a, p);
      const item = {
        id: uuid(),
        allocation_id: a.id,
        joining_plan_id: p.id,
        plan_revision: p.revision,
        status: 'Sending',
        recipient_email: a.email_id,
        cc,
        subject: rendered.subject,
        html: rendered.html,
        snapshot: {
          ...p,
          joining_date: dateOnly(p.joining_date),
          required_documents: json(p.required_documents, []),
        },
        informed_by: informed.id,
        recorded_by: u.id,
        date_of_informing: informed.date,
      };
      await c.query(
        `INSERT INTO joining_email_attempts
        (id,request_key,allocation_id,joining_plan_id,plan_revision,status,recipient_email,cc,subject,html,snapshot,informed_by,recorded_by,date_of_informing)
        VALUES (?,?,?,?,?,'Sending',?,?,?,?,?,?,?,?)`,
        [
          item.id,
          body.request_key,
          a.id,
          p.id,
          p.revision,
          a.email_id,
          JSON.stringify(cc),
          item.subject,
          item.html,
          JSON.stringify(item.snapshot),
          informed.id,
          u.id,
          informed.date,
        ],
      );
      return item;
    });
    if (attempt.replay)
      return {
        id: attempt.id,
        status: attempt.status,
        failure_reason: attempt.failure_reason,
        replayed: true,
      };

    // SMTP must never execute while a database transaction is open. A durable
    // Sending attempt prevents retries from sending again after a lost response.
    let result,
      delivery = 'Sent',
      failure = null;
    try {
      result = await w.sendEmail({
        to: attempt.recipient_email,
        cc: attempt.cc,
        subject: attempt.subject,
        html: attempt.html,
      });
      const accepted = result.accepted?.map((item) => String(item.address || item).toLowerCase());
      if (!accepted?.includes(attempt.recipient_email.toLowerCase())) {
        delivery = accepted ? 'Failed' : 'Unknown';
        failure = accepted
          ? 'The mail server did not accept the cadet recipient.'
          : 'The mail server did not report recipient acceptance. Check delivery before retrying.';
      }
    } catch (error) {
      // A connection loss/timeout can happen after SMTP accepted DATA.
      delivery =
        error.responseCode >= 400 || ['EAUTH', 'EENVELOPE', 'EDNS', 'ECONNECTION'].includes(error.code)
          ? 'Failed'
          : 'Unknown';
      failure =
        delivery === 'Unknown'
          ? 'Delivery could not be confirmed. Check the mail server before sending again.'
          : 'The mail server rejected this email. Check the recipient or mail configuration and retry.';
    }
    await w.transaction(async (c) => {
      const a = await w.loadAllocation(c, allocationId, true);
      await c.query(
        'UPDATE joining_email_attempts SET status=?,email_message_id=?,failure_reason=? WHERE id=?',
        [delivery, result?.messageId || null, failure, attempt.id],
      );
      if (delivery === 'Sent' || delivery === 'Failed')
        await c.query(
          `INSERT INTO allocation_communications
        (id,joining_plan_id,plan_revision,informed_by,recorded_by,date_of_informing,mode,confirmation_received,delivery_status,email_message_id,failure_reason,recorded_at)
        VALUES (?,?,?,?,?,?,'Email',0,?,?,?,CURRENT_TIMESTAMP(3))`,
          [
            uuid(),
            planId,
            attempt.plan_revision,
            attempt.informed_by,
            u.id,
            attempt.date_of_informing,
            delivery,
            result?.messageId || null,
            failure,
          ],
        );
      if (delivery === 'Sent') {
        const [[p]] = await c.query('SELECT * FROM joining_plans WHERE id=?', [planId]);
        const f = roleFields(p.vessel_role);
        if (
          Number(p.revision) === Number(attempt.plan_revision) &&
          a[f.status] === 'Allocated' &&
          a[f.vessel] &&
          !a.cycle_deleted_at &&
          Number(a.is_active) === 1
        ) {
          await c.query(
            "UPDATE joining_plans SET status=CASE WHEN status='Confirmed' THEN status ELSE 'Informed' END WHERE id=?",
            [planId],
          );
        }
      }
      await w.activity(
        c,
        u,
        a,
        'SEND_CTV_JOINING_INTIMATION',
        `${attempt.subject}; revision ${attempt.plan_revision}; delivery: ${delivery}`,
      );
    });
    return { id: attempt.id, status: delivery, failure_reason: failure };
  };
  return { preview, send };
};
module.exports = { createJoiningEmailService };
