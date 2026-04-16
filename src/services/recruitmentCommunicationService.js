const { sendEmail, emailTemplates } = require('./emailService');
const recruitmentCommunicationDao = require('../dao/recruitmentCommunicationDao');

const logAndSendEmail = async ({
  to,
  template,
  templateData,
  drive_id = null,
  cadet_id = null,
  institute_id = null,
  communication_type,
  remarks = null,
  sent_by = null,
  attachments = [],
}) => {
  const content = template(templateData);

  try {
    await sendEmail({
      to,
      subject: content.subject,
      html: content.html,
      attachments,
    });

    await recruitmentCommunicationDao.createCommunication({
      drive_id,
      cadet_id,
      institute_id,
      communication_type,
      recipient_email: to,
      subject: content.subject,
      remarks,
      payload_json: templateData,
      send_status: 'sent',
      sent_by,
    });

    return { success: true };
  } catch (error) {
    await recruitmentCommunicationDao.createCommunication({
      drive_id,
      cadet_id,
      institute_id,
      communication_type,
      recipient_email: to,
      subject: content.subject,
      remarks,
      payload_json: {
        ...templateData,
        error: error.message,
      },
      send_status: 'failed',
      sent_by,
    });

    throw error;
  }
};

module.exports = {
  emailTemplates,
  logAndSendEmail,
};
