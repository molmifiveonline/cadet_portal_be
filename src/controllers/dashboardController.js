const dashboardDao = require('../dao/dashboardDao');

const getStats = async (req, res) => {
  try {
    const stats = await dashboardDao.getDashboardStats();
    res.json({ data: stats });
  } catch (error) {
    console.error('Dashboard Stats Error:', error);
    res.status(500).json({
      message: 'Error fetching dashboard statistics',
      error: error.message,
    });
  }
};

module.exports = {
  getStats,
};
