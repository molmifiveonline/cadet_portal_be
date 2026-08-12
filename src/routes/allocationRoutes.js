const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware');
const { requirePermission, requireSuperAdmin } = require('../middleware/permissionMiddleware');
const controller = require('../controllers/allocationController');
const masters = require('../controllers/allocationMasterController');

const router = express.Router();
router.use(authMiddleware);

router.get('/masters/courses', requirePermission('allocation-masters', 'view'), masters.listCourses);
router.post('/masters/courses', requirePermission('allocation-masters', 'manage'), masters.saveCourse);
router.put('/masters/courses/:id', requirePermission('allocation-masters', 'manage'), masters.saveCourse);
router.get('/masters/formulas', requirePermission('allocation-masters', 'view'), masters.listFormulas);
router.post('/masters/formulas', requireSuperAdmin, masters.createFormula);
router.post('/masters/formulas/:id/activate', requireSuperAdmin, masters.activateFormula);
router.get('/masters/vessel-types', requirePermission('allocation-masters', 'view'), masters.listVesselTypes);
router.post('/masters/vessel-types', requireSuperAdmin, masters.saveVesselType);
router.put('/masters/vessel-types/:id', requireSuperAdmin, masters.saveVesselType);

router.get('/admins', requirePermission('allocations', 'communicate'), controller.listAdmins);
router.get('/joining-plans', requirePermission('allocations', 'view'), controller.listJoiningPlans);
router.post('/joining-plans/:joiningPlanId/communications', requirePermission('allocations', 'communicate'), controller.recordCommunication);
router.post('/candidate-allocations/:allocationId/joining-plan', requirePermission('allocations', 'edit'), controller.createJoiningPlan);
router.put('/candidate-allocations/:allocationId/scores', requirePermission('allocations', 'edit'), controller.updateScores);
router.put('/candidate-allocations/:allocationId/vessel', requirePermission('allocations', 'edit'), controller.updateVesselAllocation);
router.post('/candidate-allocations/:allocationId/move-rank', requirePermission('allocations', 'edit'), controller.moveRank);
router.delete('/candidate-allocations/:allocationId', requirePermission('allocations', 'edit'), controller.removeCandidate);
router.get('/rank-lists/:rankListId/eligible-candidates', requirePermission('allocations', 'view'), controller.listEligibleCandidates);
router.post('/rank-lists/:rankListId/candidates', requirePermission('allocations', 'edit'), controller.addCandidates);
router.post('/rank-lists/:rankListId/reset-ranks', requirePermission('allocations', 'edit'), controller.resetRanks);
router.post('/rank-lists/:rankListId/finalize', requirePermission('allocations', 'finalize'), controller.finalizeRankList);
router.post('/rank-lists/:rankListId/unlock', requireSuperAdmin, controller.unlockRankList);
router.get('/', requirePermission('allocations', 'view'), controller.listCycles);
router.post('/', requirePermission('allocations', 'create'), controller.createCycle);
router.delete('/:id', requirePermission('allocations', 'edit'), controller.deleteCycle);
router.get('/:id', requirePermission('allocations', 'view'), controller.getCycle);

module.exports = router;
