const nodemailer = require('nodemailer');

// Create email transporter
const createTransporter = () => {
  // Check if using a service like Gmail
  if (process.env.EMAIL_SERVICE && process.env.EMAIL_SERVICE !== 'custom') {
    return nodemailer.createTransporter({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  // Custom SMTP configuration
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
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
};

module.exports = {
  sendEmail,
  sendBulkEmails,
  emailTemplates,
};
