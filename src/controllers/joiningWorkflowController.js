const { createJoiningWorkflow } = require('../services/joiningWorkflowService');
const { createJoiningEmailService } = require('../services/joiningEmailService');
const { createJoiningWorkflowQueries } = require('../services/joiningWorkflowQueries');
const workflow = createJoiningWorkflow(),
  email = createJoiningEmailService(workflow),
  queries = createJoiningWorkflowQueries(workflow);
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Joining workflow:', error.message);
    res
      .status(error.status || 500)
      .json({
        success: false,
        message: error.status
          ? error.message
          : 'Joining operation failed. Reload to check its saved status before retrying.',
      });
  }
};
module.exports = {
  save: handle((req) => workflow.save(req.user, req.params.allocationId, req.body)),
  record: handle((req) => workflow.record(req.user, req.params.joiningPlanId, req.body)),
  assign: handle((req) => workflow.assign(req.user, req.params.allocationId, req.body)),
  staff: handle((req) => workflow.staff(req.user)),
  preview: handle((req) => email.preview(req.user, req.params.joiningPlanId, req.query.revision)),
  send: handle((req) => email.send(req.user, req.params.joiningPlanId, req.body)),
  get: handle((req) => queries.get(req.user, req.params.allocationId)),
  list: handle((req) => queries.list(req.user, req.query)),
  history: handle((req) => queries.history(req.user, req.params.allocationId)),
  lookups: handle((req) => queries.lookups(req.user, req.params.allocationId)),
  // Legacy callers must provide the new role/version contract. They cannot
  // update two vessel slots from a stale whole-allocation form.
  legacySave: handle((req) => workflow.save(req.user, req.params.allocationId, req.body)),
  communications: handle(async (req) => {
    const id = await workflow.allocationForPlan(req.params.joiningPlanId);
    return (await queries.history(req.user, id)).filter(
      (r) => r.kind === 'contact' && r.joining_plan_id === req.params.joiningPlanId,
    );
  }),
};
