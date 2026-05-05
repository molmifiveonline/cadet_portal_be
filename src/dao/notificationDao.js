const db = require('../config/database');

const createNotification = async ({ recipient_type, recipient_id, title, message, url = null }) => {
  try {
    const query = `
      INSERT INTO notifications (recipient_type, recipient_id, title, message, url)
      VALUES (?, ?, ?, ?, ?)
    `;
    const [result] = await db.query(query, [recipient_type, recipient_id, title, message, url]);
    return result.insertId;
  } catch (error) {
    console.error('Error creating notification:', error);
    // Non-blocking
    return null;
  }
};

const getUserNotifications = async (recipient_type, recipient_id, limit = 20) => {
  try {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    let query = `
      SELECT * FROM notifications 
      WHERE recipient_type = ?
    `;
    const params = [recipient_type];

    if (recipient_id) {
      query += ` AND (recipient_id = ? OR recipient_id IS NULL)`;
      params.push(recipient_id);
    } else {
      query += ` AND recipient_id IS NULL`;
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(safeLimit);

    const [rows] = await db.query(query, params);
    return rows;
  } catch (error) {
    console.error('Error fetching notifications:', error);
    throw error;
  }
};

const getUnreadCount = async (recipient_type, recipient_id) => {
  try {
    let query = `
      SELECT COUNT(*) as count FROM notifications 
      WHERE recipient_type = ? AND is_read = FALSE
    `;
    const params = [recipient_type];

    if (recipient_id) {
      query += ` AND (recipient_id = ? OR recipient_id IS NULL)`;
      params.push(recipient_id);
    } else {
      query += ` AND recipient_id IS NULL`;
    }

    const [rows] = await db.query(query, params);
    return rows[0].count;
  } catch (error) {
    console.error('Error counting unread notifications:', error);
    throw error;
  }
};

const markAsRead = async (id, recipient_type, recipient_id) => {
  try {
    let query = `
      UPDATE notifications SET is_read = TRUE 
      WHERE id = ? AND recipient_type = ?
    `;
    const params = [id, recipient_type];

    if (recipient_id) {
      query += ` AND (recipient_id = ? OR recipient_id IS NULL)`;
      params.push(recipient_id);
    } else {
      query += ` AND recipient_id IS NULL`;
    }

    const [result] = await db.query(query, params);
    return result.affectedRows > 0;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};

const markAllAsRead = async (recipient_type, recipient_id) => {
  try {
    let query = `
      UPDATE notifications SET is_read = TRUE 
      WHERE recipient_type = ? AND is_read = FALSE
    `;
    const params = [recipient_type];

    if (recipient_id) {
      query += ` AND (recipient_id = ? OR recipient_id IS NULL)`;
      params.push(recipient_id);
    } else {
      query += ` AND recipient_id IS NULL`;
    }

    const [result] = await db.query(query, params);
    return result.affectedRows;
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
};

module.exports = {
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
};
