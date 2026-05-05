const activityLogDao = require('../dao/activityLogDao');
const { DEFAULT_PAGE_SIZE } = require('../config/constants');

const getRecentLogs = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;
    const searchTerm = req.query.search || '';
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder || 'DESC';

    // Get logs from last 3 months with search
    const logs = await activityLogDao.getLogsLast3Months(
      limit,
      offset,
      searchTerm,
      sortBy,
      sortOrder,
    );
    const total = await activityLogDao.countLogsLast3Months(searchTerm);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getRecentLogs,
};
