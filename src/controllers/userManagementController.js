const userManagementDao = require('../dao/userManagementDao');
const activityLogDao = require('../dao/activityLogDao');

const getUsers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    const users = await userManagementDao.getUsers(limit, offset, search);
    const total = await userManagementDao.countUsers(search);

    res.json({
      success: true,
      data: users,
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

const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await userManagementDao.findUserById(id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove sensitive data
    delete user.password;

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  try {
    const { email, password, role, first_name, last_name } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: 'Email and password are required' });
    }

    if (!first_name || !last_name) {
      return res
        .status(400)
        .json({ message: 'First name and last name are required' });
    }

    const existingUser = await userManagementDao.findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const newUser = await userManagementDao.createUser(
      email,
      password,
      role || 'Candidate',
      first_name,
      last_name,
    );

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'CREATE_USER',
        `Created user: ${first_name} ${last_name} (${email}) with role ${role || 'Candidate'}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: newUser,
    });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email, role, first_name, last_name, password } = req.body;

    if (!email || !first_name || !last_name || !role) {
      return res.status(400).json({
        message: 'Email, first name, last name, and role are required',
      });
    }

    // Check if user exists
    const existingUser = await userManagementDao.findUserById(id);
    if (!existingUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if email is being changed and if it's already taken by another user
    if (email !== existingUser.email) {
      const emailTaken = await userManagementDao.findUserByEmail(email);
      if (emailTaken) {
        return res
          .status(409)
          .json({ message: 'Email already in use by another user' });
      }
    }

    const updated = await userManagementDao.updateUser(
      id,
      email,
      role,
      first_name,
      last_name,
      password || null,
    );

    if (updated) {
      // Log activity
      if (req.user && req.user.id) {
        await activityLogDao.createLog(
          req.user.id,
          'UPDATE_USER',
          `Updated user: ${first_name} ${last_name} (${email}) - Role: ${role}`,
          req.ip || req.connection.remoteAddress,
        );
      }

      res.json({
        success: true,
        message: 'User updated successfully',
      });
    } else {
      res.status(400).json({ message: 'Failed to update user' });
    }
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const existingUser = await userManagementDao.findUserById(id);
    if (!existingUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent self-deletion
    if (req.user && req.user.id === id) {
      return res
        .status(400)
        .json({ message: 'You cannot delete your own account' });
    }

    const userName =
      `${existingUser.first_name || ''} ${existingUser.last_name || ''}`.trim() ||
      existingUser.email;

    const deleted = await userManagementDao.deleteUser(id);

    if (deleted) {
      // Log activity
      if (req.user && req.user.id) {
        await activityLogDao.createLog(
          req.user.id,
          'DELETE_USER',
          `Deleted user: ${userName} (${existingUser.email})`,
          req.ip || req.connection.remoteAddress,
        );
      }

      res.json({
        success: true,
        message: 'User deleted successfully',
      });
    } else {
      res.status(400).json({ message: 'Failed to delete user' });
    }
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
};
