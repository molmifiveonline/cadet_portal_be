const nodemailer = require("nodemailer");

// Create email transporter
const createTransporter = () => {
  // Check if using a service like Gmail
  if (process.env.EMAIL_SERVICE && process.env.EMAIL_SERVICE !== "custom") {
    return nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  // Custom SMTP configuration
  console.log("  SMTP Configuration Debug:");
  console.log("  SMTP_HOST:", process.env.SMTP_HOST);
  console.log("  SMTP_PORT:", process.env.SMTP_PORT);
  console.log("  SMTP_USER:", process.env.SMTP_USER);
  console.log(
    "  SMTP_PASS:",
    process.env.SMTP_PASS ? "***" + process.env.SMTP_PASS.slice(-4) : "MISSING",
  );
  console.log("  EMAIL_SERVICE:", process.env.EMAIL_SERVICE);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
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
      from: `${process.env.EMAIL_FROM_NAME || "MOLMI Recruitment"} <${process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html || options.text.replace(/\n/g, "<br>"),
      attachments: options.attachments || [],
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);

    console.log(`✉️  Email sent to ${options.to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Email sending failed:", error);
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

// Email templates
const emailTemplates = {
  instituteExcelSubmission: (data) => ({
    subject: data.subject || "Action Required: Submit Excel Data - MOLMI",
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <!--[if mso]>
        <style type="text/css">
          body, table, td { font-family: Arial, sans-serif !important; }
        </meta>
        <![endif]-->
      </head>
      <body style="margin: 0; padding: 0; background-color: #f0f4f8; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
        <!-- Outer Wrapper -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f4f8;">
          <tr>
            <td align="center" style="padding: 40px 16px;">
              <!-- Main Card -->
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
                
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #0047AB 0%, #1a73e8 100%); background-color: #1a73e8; padding: 36px 30px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700; letter-spacing: 0.5px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">📋 MOLMI Institute Portal</h1>
                    <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px; font-weight: 400;">Excel Data Submission Request</p>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding: 36px 32px 24px;">
                    <p style="margin: 0 0 18px; font-size: 16px; color: #333333; line-height: 1.6;">Dear <strong style="color: #1a73e8;">${data.instituteName}</strong>,</p>

                    <p style="margin: 0 0 18px; font-size: 16px; color: #444444; line-height: 1.6;">${data.description}</p>

                    <p style="margin: 0 0 18px; font-size: 16px; color: #444444; line-height: 1.6;">Please use the secure credentials below to access the portal and submit the requested Excel data for the <strong>${data.batch_year}</strong> administrative year.</p>
                  </td>
                </tr>


                <!-- Credentials Card -->
                <tr>
                  <td style="padding: 0 32px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f7ff; border: 1px solid #d4e5fc; border-left: 5px solid #1a73e8; border-radius: 8px; overflow: hidden;">
                      <tr>
                        <td style="padding: 20px 24px;">
                          <p style="margin: 0 0 4px; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Your Login Credentials</p>
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 12px;">
                            <tr>
                              <td style="padding: 6px 0; font-size: 16px; color: #0047AB; font-weight: 600; width: 100px;">User ID:</td>
                              <td style="padding: 6px 0; font-size: 16px; color: #1f2937; font-weight: 500; letter-spacing: 0.5px;">${data.tempUsername}</td>
                            </tr>
                          </table>
                          <p style="margin: 12px 0 0; font-size: 14px; color: #4b5563;">An OTP (One-Time Password) will be sent to your email each time you attempt to login.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Warning -->
                <tr>
                  <td style="padding: 20px 32px 0;" align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background-color: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #ef4444; border-radius: 6px; padding: 12px 20px;">
                          <p style="margin: 0; font-size: 14px; color: #b91c1c; font-weight: 600;">⚠️ Do not share these credentials with anyone.</p>
                          <p style="margin: 4px 0 0; font-size: 13px; color: #dc2626;">⏰ Credentials expire on <strong>${data.expiryDate}</strong> (7 days)</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Instructions -->
                <tr>
                  <td style="padding: 24px 32px 8px;">
                    <p style="margin: 0; font-size: 16px; color: #444444; line-height: 1.6;">Please download the attached Excel format, fill in the required cadet details, and upload it via the portal:</p>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td align="center" style="padding: 24px 32px 36px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="border-radius: 8px; background: linear-gradient(135deg, #1a73e8 0%, #0047AB 100%); background-color: #1a73e8;">
                          <a href="${data.link}" target="_blank" style="display: inline-block; padding: 16px 40px; color: #ffffff; font-size: 16px; font-weight: 700; text-decoration: none; text-transform: uppercase; letter-spacing: 1px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">Access Portal &amp; Upload</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Sign-off -->
                <tr>
                  <td style="padding: 0 32px 32px;">
                    <p style="margin: 0 0 6px; font-size: 16px; color: #444444;">If you require any assistance, please contact the MOLMI administration team.</p>
                    <p style="margin: 18px 0 0; font-size: 16px; color: #444444;">Best regards,<br><strong style="color: #0047AB;">MOLMI Administration</strong></p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #f9fafb; padding: 20px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
                    <p style="margin: 0; font-size: 12px; color: #9ca3af; line-height: 1.5;">This is an automated message from the MOLMI administrative system.<br>Please do not reply directly to this email.</p>
                    <p style="margin: 8px 0 0; font-size: 11px; color: #d1d5db;">&copy; ${new Date().getFullYear()} MOLMI. All rights reserved.</p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  }),

  // Institute Shortlisted Cadets View email template
  instituteShortlistView: (data) => ({
    subject: data.subject || "Action Required: View Shortlisted Cadets - MOLMI",
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f0f4f8; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f4f8;">
          <tr>
            <td align="center" style="padding: 40px 16px;">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">

                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #0f766e 0%, #059669 100%); background-color: #059669; padding: 36px 30px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700; letter-spacing: 0.5px;">🎯 MOLMI Institute Portal</h1>
                    <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px; font-weight: 400;">Shortlisted Cadets Announcement</p>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding: 36px 32px 24px;">
                    <p style="margin: 0 0 18px; font-size: 16px; color: #333333; line-height: 1.6;">Dear <strong style="color: #059669;">${data.instituteName}</strong>,</p>
                    <p style="margin: 0 0 18px; font-size: 16px; color: #444444; line-height: 1.6;">We are pleased to inform you that cadet(s) from your institute have been shortlisted for further processing.</p>

                    <!-- Highlight Box -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0; background-color: #ecfdf5; border-radius: 8px; border: 1px solid #a7f3d0;">
                      <tr>
                        <td align="center" style="padding: 20px;">
                          <p style="margin: 0; font-size: 24px; font-weight: 700; color: #059669;">${data.cadetCount} Cadet(s) Shortlisted</p>
                        </td>
                      </tr>
                    </table>

                    <p style="margin: 0 0 18px; font-size: 16px; color: #444444; line-height: 1.6;">Please use your Institute User ID to login. An OTP will be sent to your registered email each time you attempt to login.</p>

                    <!-- Credentials Card -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 5px solid #059669; border-radius: 8px; overflow: hidden;">
                      <tr>
                        <td style="padding: 20px 24px;">
                          <p style="margin: 0 0 4px; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Your Login Credentials</p>
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 12px;">
                            <tr>
                              <td style="padding: 6px 0; font-size: 16px; color: #334155; font-weight: 600; width: 100px;">User ID:</td>
                              <td style="padding: 6px 0; font-size: 16px; color: #0f172a; font-weight: 600; letter-spacing: 0.5px;">${data.tempUsername}</td>
                            </tr>
                          </table>
                          <p style="margin: 12px 0 0; font-size: 14px; color: #4b5563;">An OTP (One-Time Password) will be sent to your email each time you attempt to login.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Warning -->
                <tr>
                  <td style="padding: 0 32px 24px;">
                    <div style="padding: 16px; background-color: #fffbeb; border-radius: 8px; border-left: 4px solid #f59e0b;">
                      <p style="margin: 0 0 8px; font-size: 14px; color: #b45309; font-weight: 600;">⚠️ Security Notice</p>
                      <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #92400e; line-height: 1.5;">
                        <li>Do not share your User ID with anyone.</li>
                        <li>These credentials will expire on <strong>${data.expiryDate}</strong> (7 days).</li>
                      </ul>
                    </div>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td align="center" style="padding: 0 32px 36px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="border-radius: 6px; background: linear-gradient(135deg, #0f766e, #059669); background-color: #059669; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);">
                          <a href="${data.link}" target="_blank" style="font-size: 15px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #ffffff; text-decoration: none; font-weight: 600; padding: 14px 32px; border: 1px solid #059669; display: inline-block; border-radius: 6px;">Login &amp; View Cadets</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
                    <p style="margin: 0; color: #64748b; font-size: 13px; font-weight: 500;">&copy; ${new Date().getFullYear()} MOL Maritime India. All rights reserved.</p>
                    <p style="margin: 8px 0 0; color: #94a3b8; font-size: 12px;">This is an automated message. Please do not reply to this email.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  }),

  // Institute OTP Login email template
  instituteOtpLogin: (data) => ({
    subject: `Login OTP for MOLMI Institute Portal: ${data.otp}`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f0f4f8; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f4f8;">
          <tr>
            <td align="center" style="padding: 40px 16px;">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
                
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #0047AB 0%, #1a73e8 100%); background-color: #1a73e8; padding: 36px 30px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700; letter-spacing: 0.5px;">🔒 Login Verification</h1>
                    <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px; font-weight: 400;">MOLMI Institute Portal</p>
                  </td>
                </tr>

                <!-- Body Text -->
                <tr>
                  <td style="padding: 36px 32px 24px;">
                    <p style="margin: 0 0 18px; font-size: 16px; color: #333333; line-height: 1.6;">Hello,</p>
                    <p style="margin: 0 0 18px; font-size: 16px; color: #444444; line-height: 1.6;">Use the following OTP code to verify your login attempt. This code is valid for <strong>${data.expiryMinutes || 10} minutes</strong>.</p>
                  </td>
                </tr>

                <!-- OTP Card -->
                <tr>
                  <td align="center" style="padding: 0 32px 32px;">
                    <div style="background-color: #f1f5f9; padding: 24px; border-radius: 8px; border: 1px dashed #cbd5e1; display: inline-block;">
                      <span style="font-size: 42px; font-weight: 800; color: #1e3a8a; letter-spacing: 8px; font-family: 'Courier New', Courier, monospace;">${data.otp}</span>
                    </div>
                  </td>
                </tr>

                <!-- Warning -->
                <tr>
                  <td style="padding: 0 32px 32px; text-align: center;">
                    <p style="margin: 0; font-size: 14px; color: #ef4444; font-weight: 600;">⚠️ Do not share this OTP with anyone.</p>
                    <p style="margin: 12px 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">If you did not request this code, you can safely ignore this email.</p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
                    <p style="margin: 0; color: #64748b; font-size: 13px; font-weight: 500;">&copy; ${new Date().getFullYear()} MOL Maritime India. All rights reserved.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  }),

  instituteSubmissionConfirmation: (data) => ({
    subject:
      data.subject ||
      `Institute submission received for ${data.driveName || "Recruitment Drive"}`,
    html: `
      <p>Hello MOLMI Team,</p>
      <p>The institute <strong>${data.instituteName}</strong> has submitted cadet data for the recruitment drive <strong>${data.driveName || "N/A"}</strong>.</p>
      <p>Batch Year: <strong>${data.batchYear || "N/A"}</strong><br/>
      Course Type: <strong>${data.courseType || "N/A"}</strong></p>
      <p>Remarks:</p>
      <p>${data.remarks || "No remarks provided."}</p>
    `,
  }),

  stageInvite: (data) => ({
    subject: data.subject,
    html: `
      <p>Dear ${data.recipientName || "Cadet"},</p>
      <p>${data.message}</p>
      <p>
        ${data.dateLabel || "Date"}: <strong>${data.date || "TBD"}</strong><br/>
        ${data.timeLabel || "Time"}: <strong>${data.time || "TBD"}</strong><br/>
        ${data.location ? `${data.locationLabel || "Location"}: <strong>${data.location}</strong><br/>` : ""}
        ${data.documentLink ? `Document Upload Link: <a href="${data.documentLink}" target="_blank">Open Link</a><br/>` : ""}
      </p>
      <p>Remarks:</p>
      <p>${data.remarks || "No remarks provided."}</p>
      <p>Regards,<br/>MOLMI Recruitment Team</p>
    `,
  }),

  instituteSelectionConfirmation: (data) => ({
    subject:
      data.subject ||
      `Selected cadets confirmed for ${data.driveName || "Recruitment Drive"}`,
    html: `
      <p>Dear ${data.instituteName},</p>
      <p>The following cadets have been confirmed after the medical stage for <strong>${data.driveName || "the current drive"}</strong>:</p>
      <ul>
        ${(data.cadets || [])
          .map(
            (cadet) =>
              `<li>${cadet.name_as_in_indos_cert || cadet.name || "Cadet"} (${cadet.cadet_unique_id || cadet.id})</li>`,
          )
          .join("")}
      </ul>
      <p>Remarks:</p>
      <p>${data.remarks || "No remarks provided."}</p>
    `,
  }),

  // Forgot password email template
  forgotPassword: (data) => ({
    subject: "Action Required: Reset Your MOLMI Password",
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <!--[if mso]>
        <style type="text/css">
          body, table, td { font-family: Arial, sans-serif !important; }
        </style>
        <![endif]-->
      </head>
      <body style="margin: 0; padding: 0; background-color: #f0f4f8; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f4f8;">
          <tr>
            <td align="center" style="padding: 40px 16px;">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
                
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #0047AB 0%, #1a73e8 100%); background-color: #1a73e8; padding: 36px 30px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700; letter-spacing: 0.5px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">🔒 Password Reset</h1>
                    <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px; font-weight: 400;">MOLMI Recruitment Portal</p>
                  </td>
                </tr>

                <!-- Body Text -->
                <tr>
                  <td style="padding: 36px 32px 24px;">
                    <p style="margin: 0 0 18px; font-size: 16px; color: #333333; line-height: 1.6;">Hello,</p>

                    <p style="margin: 0 0 18px; font-size: 16px; color: #444444; line-height: 1.6;">We received a request to reset your password for the MOLMI Cadet Management Portal. If you made this request, please click the button below to set a new password.</p>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td align="center" style="padding: 0 32px 32px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="border-radius: 6px; background: linear-gradient(to right, #0047AB, #1a73e8); background-color: #0047AB; box-shadow: 0 4px 12px rgba(26, 115, 232, 0.3);">
                          <a href="${data.resetLink}" target="_blank" style="font-size: 15px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #ffffff; text-decoration: none; font-weight: 600; padding: 14px 32px; border: 1px solid #0047AB; display: inline-block; border-radius: 6px;">Reset My Password</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Context/Warning -->
                <tr>
                  <td style="padding: 0 32px 32px;">
                    <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.5;">If the button above does not work, paste this link into your web browser:</p>
                    <p style="margin: 8px 0 0; font-size: 13px; color: #1a73e8; line-height: 1.5; word-break: break-all;">
                      <a href="${data.resetLink}" style="color: #1a73e8; text-decoration: underline;">${data.resetLink}</a>
                    </p>
                    <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
                      <p style="margin: 0; font-size: 13px; color: #9ca3af; line-height: 1.5;">If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
                    </div>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
                    <p style="margin: 0; color: #64748b; font-size: 13px; font-weight: 500;">&copy; ${new Date().getFullYear()} MOL Maritime India. All rights reserved.</p>
                    <p style="margin: 8px 0 0; color: #94a3b8; font-size: 12px;">This is an automated message. Please do not reply to this email.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  }),

  // Password reset success confirmation template
  resetPasswordSuccess: () => ({
    subject: "Password Reset Successful",
    html: `<p>Hi,</p><p>Your password has been successfully updated.</p>`,
  }),
};

module.exports = {
  sendEmail,
  sendBulkEmails,
  emailTemplates,
};
