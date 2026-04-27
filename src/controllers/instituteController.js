const instituteDao = require('../dao/instituteDao');
const activityLogDao = require('../dao/activityLogDao');
const { DEFAULT_PAGE_SIZE } = require('../config/constants');

const normalizeEmail = (email) =>
  typeof email === 'string' ? email.trim().toLowerCase() : '';

const getContactEmailValues = (contactEmails) =>
  Array.isArray(contactEmails)
    ? contactEmails
        .map((contact) =>
          normalizeEmail(
            typeof contact === 'string' ? contact : contact && contact.email,
          ),
        )
        .filter(Boolean)
    : [];

const hasDuplicateContactEmails = (contactEmails) => {
  const emails = getContactEmailValues(contactEmails);
  return new Set(emails).size !== emails.length;
};

const ensureDefaultContact = (contactEmails) => {
  if (!contactEmails.some((contact) => contact.isDefault)) {
    contactEmails[0].isDefault = true;
  }
};

const createInstitute = async (req, res) => {
  try {
    const {
      institute_name,
      location,
      address,
      institute_type,
      contact_emails,
      status,
    } = req.body;

    if (
      !institute_name ||
      !address ||
      !location ||
      !Array.isArray(contact_emails) ||
      contact_emails.length === 0 ||
      getContactEmailValues(contact_emails).length === 0
    ) {
      return res.status(400).json({ message: 'Required fields are missing' });
    }

    if (hasDuplicateContactEmails(contact_emails)) {
      return res
        .status(400)
        .json({ message: 'Duplicate contact emails are not allowed' });
    }

    const duplicateInstitute = await instituteDao.getInstituteByContactEmails(
      getContactEmailValues(contact_emails),
    );
    if (duplicateInstitute) {
      return res.status(409).json({
        message: 'A contact email is already used by another institute',
        email: duplicateInstitute.duplicate_email,
      });
    }

    ensureDefaultContact(contact_emails);

    const id = await instituteDao.createInstitute({
      institute_name,
      address,
      location,
      institute_type,
      contact_emails,
      status: status || 'active',
    });

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'CREATE_INSTITUTE',
        `Created institute: ${institute_name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.status(201).json({
      message: 'Institute created successfully',
      id,
    });
  } catch (error) {
    console.error('Create Institute Error:', error);
    res
      .status(500)
      .json({ message: 'Error creating institute', error: error.message });
  }
};

const getAllInstitutes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const search = req.query.search || '';
    const hasSubmissions = req.query.hasSubmissions === 'true';
    let sortBy = req.query.sortBy || 'created_at';
    let sortOrder = req.query.sortOrder || 'DESC';

    // Basic validation for sortBy and sortOrder to prevent SQL injection
    const validColumns = [
      'id',
      'institute_name',
      'address',
      'location',
      'institute_type',
      'status',
      'created_at',
      'updated_at',
    ];
    if (!validColumns.includes(sortBy)) {
      sortBy = 'created_at';
    }

    if (!['ASC', 'DESC'].includes(sortOrder.toUpperCase())) {
      sortOrder = 'DESC';
    } else {
      sortOrder = sortOrder.toUpperCase();
    }

    const offset = (page - 1) * limit;

    const { data, total } = await instituteDao.getAllInstitutes(
      limit,
      offset,
      sortBy,
      sortOrder,
      search,
      hasSubmissions,
    );

    res.json({
      data,
      total,
      page,
      limit,
      search,
    });
  } catch (error) {
    console.error('Get All Institutes Error:', error);
    res
      .status(500)
      .json({ message: 'Error fetching institutes', error: error.message });
  }
};

const getInstituteById = async (req, res) => {
  try {
    const { id } = req.params;
    const institute = await instituteDao.getInstituteById(id);

    if (!institute) {
      return res.status(404).json({ message: 'Institute not found' });
    }

    res.json({ data: institute });
  } catch (error) {
    console.error('Get Institute By Id Error:', error);
    res
      .status(500)
      .json({ message: 'Error fetching institute', error: error.message });
  }
};

const updateInstitute = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      institute_name,
      location,
      address,
      institute_type,
      contact_emails,
      status,
    } = req.body;

    if (
      !institute_name ||
      !address ||
      !location ||
      !Array.isArray(contact_emails) ||
      contact_emails.length === 0 ||
      getContactEmailValues(contact_emails).length === 0
    ) {
      return res.status(400).json({ message: 'Required fields are missing' });
    }

    if (hasDuplicateContactEmails(contact_emails)) {
      return res
        .status(400)
        .json({ message: 'Duplicate contact emails are not allowed' });
    }

    const duplicateInstitute = await instituteDao.getInstituteByContactEmails(
      getContactEmailValues(contact_emails),
      id,
    );
    if (duplicateInstitute) {
      return res.status(409).json({
        message: 'A contact email is already used by another institute',
        email: duplicateInstitute.duplicate_email,
      });
    }

    ensureDefaultContact(contact_emails);

    const success = await instituteDao.updateInstitute(id, {
      institute_name,
      address,
      location,
      institute_type,
      contact_emails,
      status,
    });

    if (!success) {
      return res
        .status(404)
        .json({ message: 'Institute not found or no changes made' });
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'UPDATE_INSTITUTE',
        `Updated institute: ${institute_name} (ID: ${id})`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({ message: 'Institute updated successfully' });
  } catch (error) {
    console.error('Update Institute Error:', error);
    res
      .status(500)
      .json({ message: 'Error updating institute', error: error.message });
  }
};

const deleteInstitute = async (req, res) => {
  try {
    const { id } = req.params;

    // Get institute name before deleting for the log
    const institute = await instituteDao.getInstituteById(id);
    const instituteName = institute ? institute.institute_name : `ID: ${id}`;

    const success = await instituteDao.deleteInstitute(id);

    if (!success) {
      return res.status(404).json({ message: 'Institute not found' });
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'DELETE_INSTITUTE',
        `Deleted institute: ${instituteName}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({ message: 'Institute deleted successfully' });
  } catch (error) {
    console.error('Delete Institute Error:', error);
    res
      .status(500)
      .json({ message: 'Error deleting institute', error: error.message });
  }
};

const extendInstituteToken = async (req, res) => {
  try {
    const { id } = req.params;
    const { additionalDays, newExpiryDate } = req.body;

    if (!additionalDays && !newExpiryDate) {
      return res
        .status(400)
        .json({ message: 'Must provide newExpiryDate or additionalDays' });
    }

    const institute = await instituteDao.getInstituteById(id);
    if (!institute) {
      return res.status(404).json({ message: 'Institute not found' });
    }

    if (!institute.temp_expiry) {
      return res.status(400).json({
        message:
          'No active submission token found for this institute. Send an email first.',
      });
    }

    let newExpiry;
    if (newExpiryDate) {
      const parsedDate = new Date(newExpiryDate);
      if (isNaN(parsedDate)) {
        return res.status(400).json({ message: 'Invalid expiry date format' });
      }
      // Ensure date covers the end of the selected day
      parsedDate.setHours(23, 59, 59, 999);
      newExpiry = parsedDate.toISOString().slice(0, 19).replace('T', ' ');
    } else {
      if (isNaN(additionalDays) || additionalDays <= 0) {
        return res
          .status(400)
          .json({ message: 'additionalDays must be a positive number' });
      }
      const currentExpiry = new Date(institute.temp_expiry);
      const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
      baseDate.setDate(baseDate.getDate() + parseInt(additionalDays, 10));
      newExpiry = baseDate.toISOString().slice(0, 19).replace('T', ' ');
    }

    await instituteDao.extendInstituteExpiry(id, newExpiry);

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'EXTEND_INSTITUTE_TOKEN',
        `Extended token expiry to ${newExpiry} for institute: ${institute.institute_name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      success: true,
      message: `Token expiry extended to ${new Date(newExpiry).toLocaleDateString()}`,
      new_expiry: newExpiry,
    });
  } catch (error) {
    console.error('Extend Institute Token Error:', error);
    res
      .status(500)
      .json({ message: 'Error extending token', error: error.message });
  }
};

module.exports = {
  createInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  deleteInstitute,
  extendInstituteToken,
};
