const notificationDao = require('../dao/notificationDao');

/**
 * Service to handle creation of notifications across the system.
 */
const normalizeRecipientType = (role) => {
  const normalized = String(role || '').trim().toLowerCase();

  if (normalized === 'superadmin' || normalized === 'super-admin' || normalized === 'role-super-admin') {
    return 'SuperAdmin';
  }

  if (normalized === 'admin' || normalized === 'role-admin') {
    return 'Admin';
  }

  if (normalized === 'institute' || normalized === 'role-institute') {
    return 'Institute';
  }

  if (normalized === 'cadet' || normalized === 'role-cadet') {
    return 'Cadet';
  }

  return role;
};

const notify = async ({ recipient_type, recipient_id, title, message, url = null }) => {
  // recipient_type should be one of: 'SuperAdmin', 'Admin', 'Institute', 'Cadet'
  return await notificationDao.createNotification({
    recipient_type: normalizeRecipientType(recipient_type),
    recipient_id,
    title,
    message,
    url,
  });
};

/**
 * Notify everyone in a role. A null recipient_id is treated as a role broadcast.
 */
const notifyRole = async (recipient_type, title, message, url = null) => {
  return await notify({
    recipient_type: normalizeRecipientType(recipient_type),
    recipient_id: null,
    title,
    message,
    url,
  });
};

const notifySuperAdmins = async (title, message, url = null) => {
  return notifyRole('SuperAdmin', title, message, url);
};

const notifyAdmins = async (title, message, url = null) => {
  const results = await Promise.all([
    notifyRole('SuperAdmin', title, message, url),
    notifyRole('Admin', title, message, url),
  ]);

  return results.filter((id) => id !== null);
};

module.exports = {
  normalizeRecipientType,
  notify,
  notifyRole,
  notifyAdmins,
  notifySuperAdmins,
};
