const dashboardDao = require('../dao/dashboardDao');
const rolePermissionDao = require('../dao/rolePermissionDao');
const { readFilters, pageNumber } = require('../services/dashboardScope');

const getAccess = async (user) => {
  if (!user?.id)
    throw Object.assign(new Error('Authentication required'), { status: 401 });
  const access = { role: user.role };
  if (user.role === 'Institute')
    access.instituteId = user.instituteId || user.id;
  else if (user.role === 'Cadet')
    access.cadetId = await dashboardDao.resolveCadetId(user.id);
  else {
    access.canViewActivity =
      user.role === 'SuperAdmin' ||
      (await rolePermissionDao.userHasPermission(
        user.role,
        'activity-logs',
        'view',
      ));
    access.canViewFleet =
      user.role === 'SuperAdmin' ||
      (await rolePermissionDao.userHasPermission(
        user.role,
        'vessel-master',
        'view',
      ));
  }
  return access;
};

const sendError = (res, error) => {
  console.error('Dashboard error:', error.message);
  res
    .status(error.status || 500)
    .json({
      message: error.status
        ? error.message
        : 'Unable to load dashboard. Please retry.',
    });
};

const getStats = async (req, res) => {
  try {
    const filters = readFilters(req.query);
    const pages = Object.fromEntries(
      ['documents', 'ctv', 'onboarding'].map((key) => [
        key,
        pageNumber(req.query[`${key}Page`]),
      ]),
    );
    const access = await getAccess(req.user);
    res.json({
      data: await dashboardDao.getDashboardStats(
        access.role === 'Cadet' ? {} : filters,
        access,
        pages,
      ),
    });
  } catch (error) {
    sendError(res, error);
  }
};

const getCandidates = async (req, res) => {
  try {
    const filters = readFilters(req.query);
    const access = await getAccess(req.user);
    res.json({
      data: await dashboardDao.getStageCandidates(
        filters,
        access,
        req.query.stage,
        pageNumber(req.query.page),
      ),
    });
  } catch (error) {
    sendError(res, error);
  }
};

const uploadDocument = async (req, res) => {
  const db = require('../config/database');
  let connection;
  try {
    if (req.user?.role !== 'Cadet')
      throw Object.assign(
        new Error('This upload is for your personal application'),
        { status: 403 },
      );
    const cadetId = await dashboardDao.resolveCadetId(req.user.id);
    if (!cadetId)
      throw Object.assign(
        new Error('No unique application is linked to this account'),
        { status: 403 },
      );
    if (
      !req.file ||
      req.file.size > 5 * 1024 * 1024 ||
      !['application/pdf', 'image/jpeg', 'image/png'].includes(
        req.file.mimetype,
      )
    ) {
      throw Object.assign(
        new Error('Upload a PDF, JPG or PNG file up to 5 MB'),
        { status: 400 },
      );
    }
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [documents] = await connection.query(
      'SELECT id,status,original_filename,document_data IS NOT NULL AS has_data FROM cadet_documents WHERE id=? AND cadet_id=? FOR UPDATE',
      [req.params.id, cadetId],
    );
    const document = documents[0];
    if (!document)
      throw Object.assign(new Error('Document request not found'), {
        status: 404,
      });
    if (!(
      document.status === 'reupload_requested' ||
      (document.status === 'pending' &&
        !document.original_filename &&
        !document.has_data)
    )) {
      throw Object.assign(new Error('This document is not open for upload'), {
        status: 409,
      });
    }
    await connection.query(
      `UPDATE cadet_documents SET document_data=?,document_mime_type=?,original_filename=?,status='pending',reviewed_by=NULL,reviewed_at=NULL WHERE id=?`,
      [req.file.buffer, req.file.mimetype, req.file.originalname, document.id],
    );
    await connection.query(
      "UPDATE document_verifications SET status='Revoked',remarks='A requested document was uploaded and requires review',verified_at=NULL WHERE cadet_id=? AND status='Verified'",
      [cadetId],
    );
    await connection.commit();
    res.json({ success: true, message: 'Document uploaded for review' });
  } catch (error) {
    if (connection) await connection.rollback();
    sendError(res, error);
  } finally {
    connection?.release();
  }
};

module.exports = { getStats, getCandidates, uploadDocument };
