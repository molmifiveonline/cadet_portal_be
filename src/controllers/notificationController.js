const notificationDao = require('../dao/notificationDao');
const notificationService = require('../services/notificationService');
const { ROLES } = require('../config/constants');

const getRecipientContext = (user = {}) => {
  const role = notificationService.normalizeRecipientType(user.role);
  const userId =
    role === ROLES.INSTITUTE
      ? user.instituteId || user.id
      : user.id;

  return { role, userId };
};

const getMyNotifications = async (req, res) => {
  try {
    const { role, userId } = getRecipientContext(req.user);
    const limit = parseInt(req.query.limit) || 20;

    const notifications = await notificationDao.getUserNotifications(role, userId, limit);
    const unreadCount = await notificationDao.getUnreadCount(role, userId);

    res.json({
      success: true,
      data: notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('Get Notifications Error:', error);
    res.status(500).json({ success: false, message: 'Error fetching notifications' });
  }
};

const markRead = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, userId } = getRecipientContext(req.user);

    const success = await notificationDao.markAsRead(id, role, userId);

    res.json({ success });
  } catch (error) {
    console.error('Mark Read Error:', error);
    res.status(500).json({ success: false, message: 'Error marking notification as read' });
  }
};

const markAllRead = async (req, res) => {
  try {
    const { role, userId } = getRecipientContext(req.user);

    const count = await notificationDao.markAllAsRead(role, userId);

    res.json({ success: true, count });
  } catch (error) {
    console.error('Mark All Read Error:', error);
    res.status(500).json({ success: false, message: 'Error marking all as read' });
  }
};

module.exports = {
  getMyNotifications,
  markRead,
  markAllRead,
};
