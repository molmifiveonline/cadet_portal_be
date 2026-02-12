const nodemailer = require('nodemailer');

// Create email transporter
// Create email transporter
const createTransporter = () => {
  // Check for SMTP configuration (User Preference)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for others
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false, // For development
      },
    });
  }

  // Check if using a service like Gmail (Legacy support)
  if (process.env.EMAIL_SERVICE && process.env.EMAIL_SERVICE !== 'custom') {
    return nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  // Fallback Custom SMTP configuration (Legacy vars)
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_USER,
      pass: process.env.SMTP_PASSWORD || process.env.EMAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
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
};

module.exports = {
  sendEmail,
  sendBulkEmails,
  emailTemplates,
};
