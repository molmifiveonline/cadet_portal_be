const activityLogDao = require('../dao/activityLogDao');

const getRecentLogs = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const searchTerm = req.query.search || '';

    // Get logs from last 3 months with search
    const logs = await activityLogDao.getLogsLast3Months(
      limit,
      offset,
      searchTerm,
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
