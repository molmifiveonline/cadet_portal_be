const cadetDao = require('../dao/cadetDao');

const getAllCadets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const instituteId = req.query.instituteId;
    const batch = req.query.batch;
    const batchId = req.query.batchId; // Legacy support if needed, or map to batch name

    const offset = (page - 1) * limit;

    const filters = {
      search,
      instituteId,
      batch,
    };

    const { data, total } = await cadetDao.getAllCadets(limit, offset, filters);

    res.json({
      data,
      total,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get All Cadets Error:', error);
    res
      .status(500)
      .json({ message: 'Error fetching cadets', error: error.message });
  }
};

module.exports = {
  getAllCadets,
};
