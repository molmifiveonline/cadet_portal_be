const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const {
  filterExistingColumns,
  hasTable,
} = require('../services/schemaCompatibilityService');

const createCommunication = async (data) => {
  const tableExists = await hasTable('recruitment_communications');
  if (!tableExists) {
    return null;
  }

  const id = uuidv4();
  const {
    drive_id = null,
    cadet_id = null,
    institute_id = null,
    communication_type,
    recipient_email,
    subject,
    remarks = null,
    payload_json = null,
    send_status = 'pending',
    sent_by = null,
    sent_at = new Date(),
  } = data;

  const insertData = await filterExistingColumns('recruitment_communications', {
    id,
    drive_id,
    cadet_id,
    institute_id,
    communication_type,
    recipient_email,
    subject,
    remarks,
    payload_json: payload_json ? JSON.stringify(payload_json) : null,
    send_status,
    sent_by,
    sent_at,
  });
  const fields = Object.keys(insertData);
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map((field) => insertData[field]);

  await db.query(
    `INSERT INTO recruitment_communications (${fields.join(', ')}) VALUES (${placeholders})`,
    values,
  );

  return id;
};

const getDriveCommunications = async (driveId) => {
  const tableExists = await hasTable('recruitment_communications');
  if (!tableExists) {
    return [];
  }

  const [rows] = await db.query(
    `SELECT rc.*, c.name_as_in_indos_cert AS cadet_name, i.institute_name
     FROM recruitment_communications rc
     LEFT JOIN cadets c ON rc.cadet_id = c.id
     LEFT JOIN institutes i ON rc.institute_id = i.id
     WHERE rc.drive_id = ?
     ORDER BY rc.sent_at DESC, rc.created_at DESC`,
    [driveId],
  );

  return rows.map((row) => ({
    ...row,
    payload_json: (() => {
      if (!row.payload_json) return null;
      if (typeof row.payload_json === 'object') return row.payload_json;
      try {
        return JSON.parse(row.payload_json);
      } catch (error) {
        return null;
      }
    })(),
  }));
};

module.exports = {
  createCommunication,
  getDriveCommunications,
};
