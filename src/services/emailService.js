const nodemailer = require('nodemailer');

// Create email transporter
const createTransporter = () => {
  // Check if using a service like Gmail
  if (process.env.EMAIL_SERVICE && process.env.EMAIL_SERVICE !== 'custom') {
    return nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  // Custom SMTP configuration
  console.log('🔍 SMTP Configuration Debug:');
  console.log('  SMTP_HOST:', process.env.SMTP_HOST);
  console.log('  SMTP_PORT:', process.env.SMTP_PORT);
  console.log('  SMTP_USER:', process.env.SMTP_USER);
  console.log(
    '  SMTP_PASS:',
    process.env.SMTP_PASS ? '***' + process.env.SMTP_PASS.slice(-4) : 'MISSING',
  );
  console.log('  EMAIL_SERVICE:', process.env.EMAIL_SERVICE);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false, // For development; set to true in production
    },
  });
};

/**
 * Send email
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text content
 * @param {string} options.html - HTML content
 * @param {Array} options.attachments - Email attachments
 * @returns {Promise}
 */
const sendEmail = async (options) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `${process.env.EMAIL_FROM_NAME || 'MOLMI Recruitment'} <${process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html || options.text.replace(/\n/g, '<br>'),
      attachments: options.attachments || [],
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);

    console.log(`✉️  Email sent to ${options.to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    throw error;
  }
};

/**
 * Send bulk emails
 * @param {Array} emailList - List of email options
 * @returns {Promise}
 */
const sendBulkEmails = async (emailList) => {
  const results = [];

  for (const emailOptions of emailList) {
    try {
      const result = await sendEmail(emailOptions);
      results.push({
        to: emailOptions.to,
        success: true,
        messageId: result.messageId,
      });
    } catch (error) {
      results.push({
        to: emailOptions.to,
        success: false,
        error: error.message,
      });
    }
  }

  return results;
};

/**
 * Email templates
 */
const emailTemplates = {
  cvSubmission: (data) => ({
    subject: 'Submit Your CV - MOLMI Recruitment',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #0066cc; color: white; padding: 20px; text-align: center; }
          .content { background-color: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
          .button { 
            display: inline-block; 
            background-color: #0066cc; 
            color: white; 
            padding: 12px 30px; 
            text-decoration: none; 
            border-radius: 5px;
            margin: 20px 0;
          }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          .warning { color: #ff6600; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>MOLMI Recruitment</h1>
          </div>
          <div class="content">
            <p>Dear <strong>${data.cadetName}</strong>,</p>
            
            <p>Congratulations! You have been shortlisted for the MOLMI recruitment process for <strong>${data.batchName}</strong>.</p>
            
            <p>Please submit your CV by clicking the button below:</p>
            
            <div style="text-align: center;">
              <a href="${data.link}" class="button">Submit Your CV</a>
            </div>
            
            <p class="warning">⏰ This link will expire on ${data.expiryDate}</p>
            
            ${data.message ? `<p>${data.message}</p>` : ''}
            
            <p>Please ensure all information in your CV is accurate and up to date.</p>
            
            <p>Best regards,<br><strong>MOLMI Recruitment Team</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  shortlistNotification: (data) => ({
    subject: `Shortlisted for ${data.stageName} - MOLMI Recruitment`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #28a745; color: white; padding: 20px; text-align: center; }
          .content { background-color: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Congratulations!</h1>
          </div>
          <div class="content">
            <p>Dear <strong>${data.cadetName}</strong>,</p>
            
            <p>We are pleased to inform you that you have been shortlisted for <strong>${data.stageName}</strong>.</p>
            
            ${data.message ? `<p>${data.message}</p>` : ''}
            
            <p>Best regards,<br><strong>MOLMI Recruitment Team</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  testSchedule: (data) => ({
    subject: `Test Scheduled - ${data.testName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #0066cc; color: white; padding: 20px; text-align: center; }
          .content { background-color: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
          .details { background-color: white; padding: 15px; margin: 20px 0; border-left: 4px solid #0066cc; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Test Schedule</h1>
          </div>
          <div class="content">
            <p>Dear <strong>${data.cadetName}</strong>,</p>
            
            <p>You have been scheduled for the following test:</p>
            
            <div class="details">
              <p><strong>Test Name:</strong> ${data.testName}</p>
              <p><strong>Date:</strong> ${data.testDate}</p>
              <p><strong>Time:</strong> ${data.testTime}</p>
              <p><strong>Location:</strong> ${data.location}</p>
            </div>
            
            <p>Please arrive 15 minutes before the scheduled time.</p>
            
            ${data.message ? `<p>${data.message}</p>` : ''}
            
            <p>Best regards,<br><strong>MOLMI Recruitment Team</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  interviewSchedule: (data) => ({
    subject: 'Interview Scheduled - MOLMI Recruitment',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #6f42c1; color: white; padding: 20px; text-align: center; }
          .content { background-color: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
          .details { background-color: white; padding: 15px; margin: 20px 0; border-left: 4px solid #6f42c1; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Interview Schedule</h1>
          </div>
          <div class="content">
            <p>Dear <strong>${data.cadetName}</strong>,</p>
            
            <p>Congratulations! You have been shortlisted for the face-to-face interview.</p>
            
            <div class="details">
              <p><strong>Date:</strong> ${data.interviewDate}</p>
              <p><strong>Time:</strong> ${data.interviewTime}</p>
              <p><strong>Location:</strong> ${data.location}</p>
            </div>
            
            <p>Please bring the following documents:</p>
            <ul>
              <li>Original ID proof</li>
              <li>All academic certificates</li>
              <li>Recent passport size photographs</li>
            </ul>
            
            ${data.message ? `<p>${data.message}</p>` : ''}
            
            <p>Best regards,<br><strong>MOLMI Recruitment Team</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  finalSelection: (data) => ({
    subject: data.isSelected
      ? '🎉 Final Selection - MOLMI'
      : 'Recruitment Update - MOLMI',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { 
            background-color: ${data.isSelected ? '#28a745' : '#ffc107'}; 
            color: white; 
            padding: 20px; 
            text-align: center; 
          }
          .content { background-color: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${data.isSelected ? '🎉 Congratulations!' : 'Recruitment Update'}</h1>
          </div>
          <div class="content">
            <p>Dear <strong>${data.cadetName}</strong>,</p>
            
            ${
              data.isSelected
                ? `
              <p>We are delighted to inform you that you have been <strong>selected</strong> for the MOLMI cadet program!</p>
              <p>This is a significant achievement, and we look forward to welcoming you to our team.</p>
              <p>Further instructions regarding the next steps will be communicated to you shortly.</p>
            `
                : `
              <p>Thank you for your interest in the MOLMI cadet program.</p>
              <p>${data.message || 'We regret to inform you that we are unable to proceed with your application at this time.'}</p>
              <p>We wish you all the best in your future endeavors.</p>
            `
            }
            
            <p>Best regards,<br><strong>MOLMI Recruitment Team</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  instituteExcelSubmission: (data) => ({
    subject: data.subject || 'Action Required: Submit Excel Data - MOLMI',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #0066cc; color: white; padding: 20px; text-align: center; }
          .content { background-color: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          .warning { color: #ff6600; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>MOLMI Institute Submission</h1>
          </div>
          <div class="content">
            <p>Dear <strong>${data.instituteName}</strong>,</p>

            <p>${data.description}</p>

            <p>Please download the attached Excel format and submit the required data using the link below:</p>

            <div style="text-align: center; margin: 20px 0;">
              <!-- Using inline styles for better email client compatibility -->
              <a href="${data.link}" target="_blank" style="
                display: inline-block; 
                background-color: #0066cc; 
                color: #ffffff; 
                padding: 12px 30px; 
                text-decoration: none; 
                border-radius: 5px; 
                font-weight: bold;
                font-family: Arial, sans-serif;
              ">Submit Excel Sheet</a>
            </div>

            <p class="warning">⏰ This link will expire on ${data.expiryDate} (7 days)</p>

            <p>If you have any questions, please contact the administration.</p>

            <p>Best regards,<br><strong>MOLMI Administration</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  // CV Form invitation template
  cvFormInvitation: (data) => ({
    subject: 'Complete CV Details for Shortlisted Cadets - MOLMI Recruitment',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 700px; margin: 0 auto; padding: 20px; }
          .header { background-color: #0066cc; color: white; padding: 20px; text-align: center; }
          .content { background-color: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
          .cadet-list { background-color: white; padding: 20px; margin: 20px 0; border-left: 4px solid #0066cc; }
          .cadet-item { padding: 15px; margin: 10px 0; background-color: #f5f5f5; border-radius: 5px; }
          .button { 
            display: inline-block; 
            background-color: #0066cc; 
            color: white; 
            padding: 10px 25px; 
            text-decoration: none; 
            border-radius: 5px;
            margin: 10px 5px;
          }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          .warning { color: #ff6600; font-weight: bold; margin: 15px 0; }
          h3 { color: #0066cc; margin-bottom: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>MOLMI Cadet Recruitment</h1>
            <p>CV Detail Completion Request</p>
          </div>
          <div class="content">
            <p>Dear <strong>${data.instituteName}</strong>,</p>
            
            <p>Congratulations! The following cadets from your institute have been shortlisted for the MOLMI recruitment process:</p>
            
            <div class="cadet-list">
              <h3>📋 Shortlisted Cadets (${data.cadets.length})</h3>
              ${data.cadets
                .map(
                  (cadet, index) => `
                <div class="cadet-item">
                  <strong>${index + 1}. ${cadet.cadet_name}</strong><br>
                  <small>Email: ${cadet.cadet_email || 'Not provided'}</small><br>
                  <div style="margin-top: 10px;">
                    <a href="${data.frontendUrl}/cv-form/${cadet.token}" class="button">
                      Complete CV for ${cadet.cadet_name.split(' ')[0]}
                    </a>
                  </div>
                </div>
              `,
                )
                .join('')}
            </div>
            
            <p class="warning">⏰ These links will expire in 7 days (${data.expiryDate})</p>
            
            <p><strong>Instructions:</strong></p>
            <ul>
              <li>Click on the "Complete CV" button for each cadet</li>
              <li>Review the pre-filled information from our database</li>
              <li>Complete any missing or pending details</li>
              <li>Submit the form to save the updated information</li>
            </ul>
            
            <p><strong>Important Notes:</strong></p>
            <ul>
              <li>All existing data will be pre-filled and visible</li>
              <li>Only empty/missing fields can be edited</li>
              <li>Please ensure accuracy of all information</li>
              <li>Each cadet's CV must be completed separately</li>
            </ul>
            
            <p>If you need a new link or have any questions, please contact us immediately.</p>
            
            <p>Best regards,<br><strong>MOLMI Recruitment Team</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated email. For support, please contact the recruitment team.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),
};

/**
 * Send CV form email to institute with links for all shortlisted cadets
 * @param {Object} institute - Institute details
 * @param {Array} tokens - Array of token data with cadet info
 */
const sendCVFormEmail = async (institute, tokens) => {
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Calculate expiry date (7 days from now)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 7);
    const formattedExpiryDate = expiryDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const emailData = {
      instituteName: institute.institute_name,
      cadets: tokens,
      expiryDate: formattedExpiryDate,
      frontendUrl,
    };

    const template = emailTemplates.cvFormInvitation(emailData);

    await sendEmail({
      to: institute.institute_email,
      subject: template.subject,
      html: template.html,
    });

    console.log(`✉️  CV form email sent to ${institute.institute_name}`);
    return { success: true };
  } catch (error) {
    console.error('❌ CV form email sending failed:', error);
    throw error;
  }
};

module.exports = {
  sendEmail,
  sendBulkEmails,
  emailTemplates,
  sendCVFormEmail,
};
