const cadetDao = require('../dao/cadetDao');
const { ROLES } = require('../config/constants');

const getInstituteId = (user = {}) => user.instituteId || user.id;

const isInstituteUser = (user = {}) => user.role === ROLES.INSTITUTE;

const userOwnsCadet = (user = {}, cadet = {}) =>
  isInstituteUser(user) && cadet.institute_id === getInstituteId(user);

const requireInstituteCadetOwnership = (paramName = 'cadet_id') => async (req, res, next) => {
  try {
    if (!isInstituteUser(req.user)) {
      return next();
    }

    const cadetId = req.params[paramName] || req.params.id;
    const cadet = await cadetDao.getCadetById(cadetId);

    if (!cadet) {
      return res.status(404).json({ message: 'Cadet not found' });
    }

    if (!userOwnsCadet(req.user, cadet)) {
      return res.status(403).json({ message: 'Unauthorized access to this cadet data' });
    }

    req.cadet = cadet;
    return next();
  } catch (error) {
    console.error('Institute Cadet Ownership Check Error:', error);
    return res.status(500).json({
      message: 'Error checking institute access',
      error: error.message,
    });
  }
};

const requireInstitutePendingDetailEditAccess = (paramName = 'cadet_id') =>
  async (req, res, next) => {
    try {
      if (!isInstituteUser(req.user)) {
        return next();
      }

      const cadetId = req.params[paramName] || req.params.id;
      const cadet = req.cadet || await cadetDao.getCadetById(cadetId);

      if (!cadet) {
        return res.status(404).json({ message: 'Cadet not found' });
      }

      if (!userOwnsCadet(req.user, cadet)) {
        return res.status(403).json({ message: 'Unauthorized access to this cadet data' });
      }

      const hasPendingDetailAccess = cadetDao.canEditPendingDetails(cadet);

      if (!hasPendingDetailAccess) {
        return res.status(403).json({
          success: false,
          message: 'This cadet is not open for pending detail edits',
        });
      }

      req.cadet = cadet;
      return next();
    } catch (error) {
      console.error('Institute Pending Detail Edit Access Check Error:', error);
      return res.status(500).json({
        message: 'Error checking institute edit access',
        error: error.message,
      });
    }
  };

const requireSuperAdminOrInstituteCadetRead = (paramName = 'cadet_id') =>
  async (req, res, next) => {
    if (req.user?.role === ROLES.SUPER_ADMIN) {
      return next();
    }

    if (isInstituteUser(req.user)) {
      return requireInstituteCadetOwnership(paramName)(req, res, next);
    }

    return res.status(403).json({
      success: false,
      message: 'This action is restricted to Super Administrators only',
    });
  };

const blockInstitute = (message = 'Institute users are not allowed to perform this action') =>
  (req, res, next) => {
    if (isInstituteUser(req.user)) {
      return res.status(403).json({ success: false, message });
    }

    return next();
  };

module.exports = {
  getInstituteId,
  isInstituteUser,
  requireInstituteCadetOwnership,
  requireInstitutePendingDetailEditAccess,
  requireSuperAdminOrInstituteCadetRead,
  blockInstitute,
  userOwnsCadet,
};
