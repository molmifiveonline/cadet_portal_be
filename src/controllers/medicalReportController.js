const medicalReportDao = require('../dao/medicalReportDao');
const activityLogDao = require('../dao/activityLogDao');
const { DEFAULT_PAGE_SIZE } = require('../config/constants');

const createMedicalReport = async (req, res, next) => {
  try {
    const { name, status } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Medical Report Name is required',
      });
    }

    const reportId = await medicalReportDao.createMedicalReport({
      name,
      status,
    });

    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'CREATE_MEDICAL_REPORT',
        `Created new medical report: ${name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.status(201).json({
      success: true,
      message: 'Medical Report created successfully',
      data: { id: reportId },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'A medical report with this name already exists.',
      });
    }
    next(error);
  }
};

const getAllMedicalReports = async (req, res, next) => {
  try {
    const isPaging = req.query.page !== undefined || req.query.limit !== undefined;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    const filters = {
      status: req.query.status || '',
    };

    const sortKey = req.query.sort_key || 'created_at';
    const sortDir = req.query.sort_dir === 'asc' ? 'ASC' : 'DESC';

    const { data, total } = await medicalReportDao.getAllMedicalReports(
      isPaging ? limit : undefined,
      isPaging ? offset : undefined,
      search,
      filters,
      sortKey,
      sortDir,
    );

    res.json({
      success: true,
      data,
      pagination: isPaging ? {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      } : undefined,
    });
  } catch (error) {
    next(error);
  }
};

const getMedicalReportById = async (req, res, next) => {
  try {
    const report = await medicalReportDao.getMedicalReportById(req.params.id);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Medical Report not found',
      });
    }

    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    next(error);
  }
};

const updateMedicalReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const reportData = req.body;

    const existingReport = await medicalReportDao.getMedicalReportById(id);
    if (!existingReport) {
      return res.status(404).json({
        success: false,
        message: 'Medical Report not found',
      });
    }

    await medicalReportDao.updateMedicalReport(id, reportData);

    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'UPDATE_MEDICAL_REPORT',
        `Updated medical report: ${reportData.name || existingReport.name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      success: true,
      message: 'Medical Report updated successfully',
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Another medical report with this name already exists.',
      });
    }
    next(error);
  }
};

const deleteMedicalReport = async (req, res, next) => {
  try {
    const { id } = req.params;

    const report = await medicalReportDao.getMedicalReportById(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Medical Report not found',
      });
    }

    await medicalReportDao.deleteMedicalReport(id);

    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'DELETE_MEDICAL_REPORT',
        `Deleted medical report: ${report.name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      success: true,
      message: 'Medical Report deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createMedicalReport,
  getAllMedicalReports,
  getMedicalReportById,
  updateMedicalReport,
  deleteMedicalReport,
};
