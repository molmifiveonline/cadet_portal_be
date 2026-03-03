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
          .credentials { background-color: #fff; padding: 15px; border-left: 4px solid #0066cc; margin: 20px 0; }
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

            <p>Please use the following temporary credentials to log in and submit your Excel sheet:</p>

            <div class="credentials">
              <p><strong>User ID:</strong> ${data.tempUsername}</p>
              <p><strong>Password:</strong> ${data.tempPassword}</p>
            </div>

            <p class="warning">⚠️ Do not share this user ID and password with anyone.</p>

            <p>Please note that this data collection is specifically for the <strong>${data.batch_year}</strong> administrative year.</p>

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
              ">Login & Submit Excel Sheet</a>
            </div>

            <p class="warning">⏰ These credentials will expire on ${data.expiryDate} (7 days)</p>

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

  // Institute Shortlisted Cadets View email template
  instituteShortlistView: (data) => ({
    subject: data.subject || 'View Your Shortlisted Cadets - MOLMI',
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
          .warning { color: #ff6600; font-weight: bold; }
          .credentials { background-color: #fff; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0; }
          .highlight { background-color: #e8f5e9; padding: 10px; border-radius: 5px; text-align: center; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>MOLMI - Shortlisted Cadets</h1>
          </div>
          <div class="content">
            <p>Dear <strong>${data.instituteName}</strong>,</p>

            <p>We are pleased to inform you that <strong>${data.cadetCount}</strong> cadet(s) from your institute have been shortlisted.</p>

            <div class="highlight">
              <p style="font-size: 18px; font-weight: bold; color: #28a745; margin: 0;">
                ${data.cadetCount} Cadet(s) Shortlisted
              </p>
            </div>

            <p>Please use the following temporary credentials to log in and view your shortlisted cadets:</p>

            <div class="credentials">
              <p><strong>User ID:</strong> ${data.tempUsername}</p>
              <p><strong>Password:</strong> ${data.tempPassword}</p>
            </div>

            <p class="warning">⚠️ Do not share this user ID and password with anyone.</p>

            <div style="text-align: center; margin: 20px 0;">
              <a href="${data.link}" target="_blank" style="
                display: inline-block; 
                background-color: #28a745; 
                color: #ffffff; 
                padding: 12px 30px; 
                text-decoration: none; 
                border-radius: 5px; 
                font-weight: bold;
                font-family: Arial, sans-serif;
              ">Login & View Shortlisted Cadets</a>
            </div>

            <p class="warning">⏰ These credentials will expire on ${data.expiryDate} (7 days)</p>

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

  // Forgot password email template
  forgotPassword: (data) => ({
    subject: 'Reset Password Link',
    html: `
      <div style="font-family: Arial, sans-serif;">
        <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
            <h2>Reset Password Link</h2>
        </div>
        <div style="padding: 20px;">
            <p>Hi,</p>
            <p>You requested to reset your password. Click the link below to reset it:</p>
            <p><a href="${data.resetLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
            <p>If you didn't request this, you can ignore this email.</p>
        </div>
        <div style="background-color: #f4f4f4; padding: 10px; text-align: center; font-size: 12px; color: #666;">
            &copy; ${new Date().getFullYear()} Molmi. All rights reserved.
        </div>
      </div>
    `,
  }),

  // Password reset success confirmation template
  resetPasswordSuccess: () => ({
    subject: 'Password Reset Successful',
    html: `<p>Hi,</p><p>Your password has been successfully updated.</p>`,
  }),
};

module.exports = {
  sendEmail,
  sendBulkEmails,
  emailTemplates,
};
