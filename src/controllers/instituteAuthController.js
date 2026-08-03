const instituteDao = require('../dao/instituteDao');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const activityLogDao = require('../dao/activityLogDao');
const { sendEmail, emailTemplates } = require('../services/emailService');
const cadetDao = require('../dao/cadetDao');
const jwt = require('jsonwebtoken');
const {
  JWT_SECRET,
  INSTITUTE_CREDENTIAL_EXPIRY_DAYS,
  INSTITUTE_UPLOAD_TYPES,
  DRIVE_STATUS,
  INSTITUTE_FRONTEND_URL,
} = require('../config/constants');
const recruitmentDriveDao = require('../dao/recruitmentDriveDao');
const shortlistService = require('../services/shortlistService');
const recruitmentCommunicationDao = require('../dao/recruitmentCommunicationDao');
const { logAndSendEmail } = require('../services/recruitmentCommunicationService');
const { COMMUNICATION_TYPES } = require('../services/recruitmentWorkflowService');
const { generateCadetCvTemplate } = require('../services/cvTemplateService');
const notificationService = require('../services/notificationService');
const { ROLES } = require('../config/constants');
const { formatDateForDisplay } = require('../utils/dateUtils');

const INSTITUTE_RECRUITMENT_DRIVES_ROUTE = '/drives';
const INSTITUTE_LOGIN_ROUTE = '/institute-login';

const buildInstituteEmailLoginLink = (redirectPath = INSTITUTE_RECRUITMENT_DRIVES_ROUTE) =>
  `${INSTITUTE_FRONTEND_URL}${INSTITUTE_LOGIN_ROUTE}?redirect=${encodeURIComponent(redirectPath)}`;

const STATIC_INSTITUTE_REQUEST_EMAIL = {
  subject: 'Action Required: Submit Excel Data - MOLMI',
  remarks: 'Cadet data request email sent with static Excel format.',
  templates: {
    [INSTITUTE_UPLOAD_TYPES.OTHER]: {
      subject: 'Action Required: Submit Excel Data - MOLMI',
      requestType: 'Cadet details',
      description:
        'Please submit the requested cadet details using the attached Excel format. Fill in all required fields and upload the completed file through the MOLMI Institute Portal.',
      attachmentFilename:
        'TME-B.Tech(ME)-IMU Chennai -2026 Passing out-MOL-Revised.xlsx',
      attachmentPath: path.join(
        __dirname,
        '..',
        'assets',
        'email-attachments',
        'TME-B.Tech(ME)-IMU Chennai -2026 Passing out-MOL-Revised.xlsx',
      ),
    },
    [INSTITUTE_UPLOAD_TYPES.PANAMA]: {
      subject: 'Action Required: Submit Panama Cadet Details - MOLMI',
      requestType: 'Panama cadet details',
      description:
        'Please submit the requested Panama cadet pre-screening workbook using the attached Excel format and upload it through the MOLMI Institute Portal.',
      attachmentFilename: 'Panama-Recruitment.xlsx',
      attachmentPath: path.join(
        __dirname,
        '..',
        'assets',
        'email-attachments',
        'Panama-Recruitment.xlsx',
      ),
    },
  },
};

const normalizeInstituteUploadType = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'panama') return INSTITUTE_UPLOAD_TYPES.PANAMA;
  return INSTITUTE_UPLOAD_TYPES.OTHER;
};

const getInstituteRequestTemplate = (institute = {}) =>
  STATIC_INSTITUTE_REQUEST_EMAIL.templates[
    normalizeInstituteUploadType(institute.institute_upload_type)
  ] || STATIC_INSTITUTE_REQUEST_EMAIL.templates[INSTITUTE_UPLOAD_TYPES.OTHER];

const normalizeCourseType = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'deck') return 'Deck';
  if (normalized === 'engine') return 'Engine';
  return null;
};

const sendInstituteEmail = async (req, res) => {
  try {
    const { instituteIds, batch_year, course_type } = req.body;
    const resolvedCourseType = normalizeCourseType(course_type);
    const resolvedRemarks = STATIC_INSTITUTE_REQUEST_EMAIL.remarks;

    if (!instituteIds) {
      return res.status(400).json({
        message: 'Institute IDs are required',
      });
    }

    if (!resolvedCourseType) {
      return res.status(400).json({
        message: 'Course type is required and must be Deck or Engine',
      });
    }

    // Parse instituteIds if it's a string (from FormData)
    let ids = [];
    try {
      // Check if instituteIds is already an array or needs parsing
      if (Array.isArray(instituteIds)) {
        ids = instituteIds;
      } else if (typeof instituteIds === 'string') {
        // Try parsing as JSON first (in case of stringified array)
        if (instituteIds.trim().startsWith('[')) {
          ids = JSON.parse(instituteIds);
        } else {
          // Treat as comma-separated or single ID
          ids = instituteIds.split(',').map((id) => id.trim());
        }
      }
    } catch (e) {
      // Fallback
      ids = [instituteIds];
    }

    const results = [];
    const expiryDays = INSTITUTE_CREDENTIAL_EXPIRY_DAYS;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);
    const expiryDateString = formatDateForDisplay(expiryDate);

    // Format for MySQL timestamp
    const mysqlExpiryDate = expiryDate
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    const requestProgressStatuses = new Set([
      DRIVE_STATUS.REQUESTED,
      DRIVE_STATUS.RECEIVED,
      DRIVE_STATUS.SUBMITTED,
      DRIVE_STATUS.SHORTLISTED,
      DRIVE_STATUS.ASSESSMENT_COMPLETED,
      DRIVE_STATUS.INTERVIEW_COMPLETED,
      DRIVE_STATUS.MEDICAL_COMPLETED,
      DRIVE_STATUS.CLOSED,
    ]);

    for (const id of ids) {
      const institute = await instituteDao.getInstituteById(id);
      if (!institute) {
        results.push({ id, status: 'failed', reason: 'Institute not found' });
        continue;
      }

      if (institute.status !== 'active') {
        results.push({ id, status: 'failed', reason: 'Institute is inactive' });
        continue;
      }

      const requestTemplate = getInstituteRequestTemplate(institute);
      const resolvedSubject =
        requestTemplate.subject || STATIC_INSTITUTE_REQUEST_EMAIL.subject;
      if (!fs.existsSync(requestTemplate.attachmentPath)) {
        results.push({
          id,
          status: 'failed',
          reason: 'Excel format file is missing',
        });
        continue;
      }

      const staticAttachment = fs.readFileSync(requestTemplate.attachmentPath);

      // Generate Temp Username (No password needed now)
      const tempUsername = `SUB-${Math.floor(100000 + Math.random() * 900000)}`;

      // Store in DB (password is NULL or empty now)
      await instituteDao.updateInstituteCredentials(
        id,
        tempUsername,
        null, // No static password
        mysqlExpiryDate,
        batch_year || new Date().getFullYear(),
        resolvedCourseType,
      );

      // Generate Link (No token needed now)
      const link = buildInstituteEmailLoginLink();
      let drive = null;

      try {
        drive = await recruitmentDriveDao.getDriveByInstituteYearCourseType(
          id,
          batch_year || new Date().getFullYear(),
          resolvedCourseType
        );
      } catch (driveErr) {
        console.error('Error resolving drive before sending institute email:', driveErr);
      }

      // Prepare Email
      const emailContent = emailTemplates.instituteExcelSubmission({
        instituteName: institute.institute_name,
        subject: resolvedSubject,
        description: requestTemplate.description,
        link,
        expiryDate: expiryDateString,
        tempUsername,
        batch_year: batch_year || new Date().getFullYear(),
        course_type: resolvedCourseType,
        request_type: requestTemplate.requestType,
      });

      // Determine target Email
      const targetEmail = instituteDao.getDefaultContactEmail(institute);

      if (!targetEmail) {
        results.push({
          id,
          status: 'failed',
          reason: 'No contact email found',
        });
        continue;
      }

      // Send Email
      try {
        await logAndSendEmail({
          to: targetEmail,
          template: () => emailContent,
          templateData: {
            instituteName: institute.institute_name,
            subject: resolvedSubject,
            description: requestTemplate.description,
            remarks: resolvedRemarks,
            batch_year: batch_year || new Date().getFullYear(),
            course_type: resolvedCourseType,
            request_type: requestTemplate.requestType,
          },
          drive_id: drive?.id || null,
          institute_id: id,
          communication_type: COMMUNICATION_TYPES.INSTITUTE_REQUEST,
          remarks: resolvedRemarks,
          sent_by: req.user?.id || null,
          attachments: [
            {
              filename: requestTemplate.attachmentFilename,
              content: staticAttachment,
            },
          ],
        });
        results.push({
          id,
          status: 'success',
          email: targetEmail,
        });

        // Notify Institute
        await notificationService.notify({
          recipient_type: ROLES.INSTITUTE,
          recipient_id: id,
          title: 'Cadet Data Request',
          message: `Admin has requested cadet data for ${resolvedCourseType} (${batch_year || new Date().getFullYear()}).`,
          url: drive?.id ? `${INSTITUTE_RECRUITMENT_DRIVES_ROUTE}/${drive.id}?tab=upload` : INSTITUTE_RECRUITMENT_DRIVES_ROUTE,
        });

        // Automatically update Recruitment Drive status to 'Requested' if matching drive exists
        try {
          if (
            drive &&
            !requestProgressStatuses.has(drive.status)
          ) {
            await recruitmentDriveDao.updateRecruitmentDrive(drive.id, {
              status: DRIVE_STATUS.REQUESTED
            });
          }
        } catch (driveErr) {
          console.error('Error updating drive status after sending email:', driveErr);
        }
      } catch (err) {
        console.error(`Failed to send email to institute ${id}:`, err);
        results.push({ id, status: 'failed', reason: err.message });
      }
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'SEND_INSTITUTE_EMAIL',
        `Sent excel submission email to ${results.filter((r) => r.status === 'success').length} institutes`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      message: 'Email processing completed',
      results,
    });
  } catch (error) {
    console.error('Send Institute Email Error:', error);
    res
      .status(500)
      .json({ message: 'Error sending emails', error: error.message });
  }
};

const sendShortlistEmail = async (req, res) => {
  try {
    const { instituteIds, cadetIds, subject, remarks, drive_id } = req.body;

    if (!instituteIds) {
      return res.status(400).json({
        message: 'Institute IDs are required',
      });
    }

    // Parse instituteIds
    let ids = [];
    if (Array.isArray(instituteIds)) {
      ids = instituteIds;
    } else if (typeof instituteIds === 'string') {
      if (instituteIds.trim().startsWith('[')) {
        ids = JSON.parse(instituteIds);
      } else {
        ids = instituteIds.split(',').map((id) => id.trim());
      }
    }

    // Parse cadetIds
    let cIds = [];
    if (Array.isArray(cadetIds)) {
      cIds = cadetIds;
    } else if (typeof cadetIds === 'string' && cadetIds.trim()) {
      try {
        if (cadetIds.trim().startsWith('[')) {
          cIds = JSON.parse(cadetIds);
        } else {
          cIds = cadetIds.split(',').map((id) => id.trim());
        }
      } catch (e) {
        console.error('Error parsing cadetIds:', e);
      }
    }

    const selectedCadets = [];
    const cadetsByInstitute = new Map();
    if (cIds.length > 0) {
      for (const cadetId of cIds) {
        const cadet = await cadetDao.getCadetById(cadetId);
        if (!cadet) continue;

        selectedCadets.push(cadet);

        const instituteKey = String(cadet.institute_id);
        if (!cadetsByInstitute.has(instituteKey)) {
          cadetsByInstitute.set(instituteKey, []);
        }
        cadetsByInstitute.get(instituteKey).push(cadet);
      }
    }

    // Get shortlist count per institute to include in emails.
    // When cadetIds are supplied, count only those selected cadets.
    const shortlistCounts = cIds.length > 0
      ? Array.from(cadetsByInstitute.entries()).map(([institute_id, cadets]) => ({
          institute_id,
          count: cadets.length,
        }))
      : await shortlistService.getShortlistCountByInstitute();
    const countMap = {};
    shortlistCounts.forEach((item) => {
      countMap[item.institute_id] = item.count;
    });

    const results = [];
    const expiryDays = INSTITUTE_CREDENTIAL_EXPIRY_DAYS;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);
    const expiryDateString = formatDateForDisplay(expiryDate);

    // Format for MySQL timestamp
    const mysqlExpiryDate = expiryDate
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    for (const id of ids) {
      const institute = await instituteDao.getInstituteById(id);
      if (!institute) {
        results.push({ id, status: 'failed', reason: 'Institute not found' });
        continue;
      }

      if (institute.status !== 'active') {
        results.push({ id, status: 'failed', reason: 'Institute is inactive' });
        continue;
      }

      const instituteCadets = cadetsByInstitute.get(String(id)) || [];
      const primaryCadet = instituteCadets[0] || selectedCadets[0] || null;
      const resolvedBatchYear = primaryCadet?.batch_year || new Date().getFullYear();
      let drive = null;

      try {
        if (drive_id) {
          drive = await recruitmentDriveDao.getRecruitmentDriveById(drive_id);
        } else if (primaryCadet?.drive_id) {
          drive = await recruitmentDriveDao.getRecruitmentDriveById(primaryCadet.drive_id);
        }
      } catch (driveErr) {
        console.error('Error resolving drive before sending shortlist email:', driveErr);
      }

      const cadetCount = countMap[id] || 0;
      if (cadetCount === 0) {
        results.push({
          id,
          status: 'skipped',
          reason: 'No shortlisted cadets',
        });
        continue;
      }

      // Generate SHOR- prefix username (No password needed)
      const tempUsername = `SHOR-${Math.floor(100000 + Math.random() * 900000)}`;

      // Store in DB
      await instituteDao.updateInstituteCredentials(
        id,
        tempUsername,
        null,
        mysqlExpiryDate,
        resolvedBatchYear,
      );

      // Generate Link
      const link = buildInstituteEmailLoginLink();

      // Prepare Email
      const emailContent = emailTemplates.instituteShortlistView({
        instituteName: institute.institute_name,
        subject,
        cadetCount,
        link,
        expiryDate: expiryDateString,
        tempUsername,
      });

      // Determine target Email
      const targetEmail = instituteDao.getDefaultContactEmail(institute);

      if (!targetEmail) {
        results.push({
          id,
          status: 'failed',
          reason: 'No contact email found',
        });
        continue;
      }

      // Send Email
      try {
        const attachments = [];
        for (const cadet of instituteCadets) {
          attachments.push(
            await generateCadetCvTemplate({
              cadet,
              institute,
              drive,
            }),
          );
        }

        await logAndSendEmail({
          to: targetEmail,
          template: () => ({
            ...emailContent,
            html: `${emailContent.html}<p>Please complete the attached cadet-wise Excel pending details template(s) and upload each completed file against the matching cadet in the portal.</p><p><strong>Remarks:</strong> ${remarks || 'No remarks provided.'}</p>`,
          }),
          templateData: {
            instituteName: institute.institute_name,
            cadetCount,
            remarks,
            driveName: drive?.drive_name,
            batch_year: resolvedBatchYear,
          },
          drive_id: drive?.id || null,
          institute_id: id,
          communication_type: COMMUNICATION_TYPES.SHORTLIST,
          remarks,
          sent_by: req.user?.id || null,
          attachments,
        });
        results.push({
          id,
          status: 'success',
          email: targetEmail,
          cadetCount,
          attachmentCount: attachments.length,
        });

        for (const cadet of instituteCadets) {
          await recruitmentCommunicationDao.createCommunication({
            drive_id: drive?.id || cadet.drive_id || null,
            cadet_id: cadet.id,
            institute_id: id,
            communication_type: COMMUNICATION_TYPES.SHORTLIST,
            recipient_email: targetEmail,
            subject: emailContent.subject,
            remarks,
            payload_json: {
              instituteName: institute.institute_name,
              cadetCount,
              cadetId: cadet.id,
              cadetName: cadet.name_as_in_indos_cert,
              driveName: drive?.drive_name,
              batch_year: resolvedBatchYear,
            },
            send_status: 'sent',
            sent_by: req.user?.id || null,
          });
        }

        // Notify Institute
        await notificationService.notify({
          recipient_type: ROLES.INSTITUTE,
          recipient_id: id,
          title: 'Shortlist Notification',
          message: `Admin has shortlisted ${cadetCount} cadet(s) for your institute (${resolvedBatchYear}). Please provide pending details.`,
          url: drive?.id ? `${INSTITUTE_RECRUITMENT_DRIVES_ROUTE}/${drive.id}?tab=cadets` : INSTITUTE_RECRUITMENT_DRIVES_ROUTE,
        });

        // Update cadet status for specifically shortlisted cadets
        if (instituteCadets.length > 0) {
          try {
            // Update status and email flag for selected cadets
            for (const cadet of instituteCadets) {
              await cadetDao.updateCadet(cadet.id, {
                status: 'Eligible for Assessment',
                shortlist_email_sent: 1
              });
            }
          } catch (updateErr) {
            console.error('Error updating cadet statuses after shortcut email:', updateErr);
          }
        }
      } catch (err) {
        console.error(
          `Failed to send shortlist email to institute ${id}:`,
          err,
        );
        results.push({ id, status: 'failed', reason: err.message });
      }
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        'SEND_SHORTLIST_EMAIL',
        `Sent shortlist view email to ${results.filter((r) => r.status === 'success').length} institutes`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      message: 'Shortlist email processing completed',
      results,
    });
  } catch (error) {
    console.error('Send Shortlist Email Error:', error);
    res.status(500).json({
      message: 'Error sending shortlist emails',
      error: error.message,
    });
  }
};

const loginInstitute = async (req, res) => {
  return res.status(400).json({ 
    message: 'Institute login has been upgraded to OTP-based security. Please use the OTP login flow.',
    isInstitute: true
  });
};

const verifyInstituteToken = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      if (decoded.type !== 'excel_submission') {
        return res.status(401).json({ message: 'Invalid token type' });
      }

      const instituteId = decoded.instituteId;
      const institute = await instituteDao.getInstituteById(instituteId);

      if (!institute) {
        return res.status(404).json({ message: 'Institute not found' });
      }

      if (institute.status !== 'active') {
        return res
          .status(403)
          .json({ message: 'Institute account is inactive' });
      }

      res.json({
        success: true,
        instituteName: institute.institute_name,
        valid: true,
      });
    } catch (err) {
      return res
          .status(401)
          .json({ message: 'Invalid or expired token', error: err.message });
    }
  } catch (error) {
    console.error('Verify Token Error:', error);
    res
      .status(500)
      .json({ message: 'Error verifying token', error: error.message });
  }
};

module.exports = {
  sendInstituteEmail,
  sendShortlistEmail,
  loginInstitute,
  verifyInstituteToken,
};
