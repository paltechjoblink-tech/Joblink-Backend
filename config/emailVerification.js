const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const path = require('path');

/**
 * Get base64 encoded logo
 */
const getLogoBase64 = () => {
  try {
    const logoPath = path.join(__dirname, '../', 'LinkWhite.png');
    console.log(`🔍 Looking for logo at: ${logoPath}`);
    if (fs.existsSync(logoPath)) {
      const logoData = fs.readFileSync(logoPath);
      const base64 = logoData.toString('base64');
      console.log(`✅ Logo loaded successfully (${logoData.length} bytes)`);
      return 'data:image/png;base64,' + base64;
    } else {
      console.warn(`⚠️ Logo file not found at: ${logoPath}`);
    }
  } catch (err) {
    console.error('❌ Error loading logo:', err.message);
  }
  return null;
};

/**
 * Pending verifications storage - tracks codes sent to emails
 * Format: { email: { code: '123456', expiresAt: timestamp, attempts: 0 } }
 */
const pendingVerifications = new Map();
const MAX_VERIFICATION_ATTEMPTS = 5;
const CODE_EXPIRY_TIME = 15 * 60 * 1000; // 15 minutes
const VERIFICATION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Verified emails cache - emails that have been verified via OTP
 */
const verifiedEmails = new Map();

/**
 * Generate a random 6-digit verification code
 */
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const getEmailTemplate = (code, userEmail) => {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Verify Your Email</title>
<style>
* { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; background-color: #ffffff; }
body { background-color: #ffffff; width: 100% !important; min-width: 100% !important; }
table { width: 100% !important; max-width: 100%; border-spacing: 0; border-collapse: collapse; }
td, th { padding: 0; margin: 0; word-break: break-word; }
img { outline: none; border: none; text-decoration: none; max-width: 100%; height: auto; }
a { text-decoration: none; color: inherit; }
</style>
</head>
<body>
<table role="presentation" width="100%">
<tbody>
<tr>
<td style="padding: 0; width: 100%;">
<div style="background-color: #ffffff; padding: 20px 8px; margin: 8px; border-radius: 12px;">
<div style="text-align: center; margin: 0 0 20px 0;">
<img src="cid:logo" alt="Joblink Logo" style="max-width: 120px; height: auto; display: inline-block;">
</div>
<div style="border: 1px solid #f0f0f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px 0;">
<p style="margin: 0 0 12px 0; font-size: 14px; color: #555555;">Hello, Welcome to Joblink. Your verification code is:</p>
<div style="text-align: center; margin: 12px 0;">
<p style="margin: 0; font-size: 28px; font-weight: 500; color: #333333; letter-spacing: 12px; font-family: monospace;">${code}</p>
</div>
<p style="margin: 12px 0 8px 0; font-size: 12px; color: #555555;">This code is valid for <strong>15 minutes</strong> and can only be used once.</p>
<p style="margin: 0 0 12px 0; font-size: 12px; color: #ff6b6b; background-color: #fff5f5; padding: 8px; border-radius: 4px;"><strong>⚠️ Check your spam/junk folder if you don't see this email in your inbox.</strong></p>
<p style="margin: 0 0 12px 0; font-size: 12px; color: #555555;">Please don't share this code with anyone. Joblink support will never ask for your verification code.</p>
<p style="margin: 12px 0 0 0; font-size: 12px; color: #555555;">You are receiving this email because a verification code was requested for you to be able to create Joblink account. If you did not request this, ignore this email.</p>
<p style="margin: 12px 0 0 0; font-size: 12px; color: #555555;">Regards,</p>
<p style="margin: 0; font-size: 12px; color: #555555;">The Joblink Team</p>
</div>
<div style="text-align: center;">
<p style="margin: 0 0 6px 0; font-size: 11px; color: #888888; font-weight: 700;">Joblink</p>
<p style="margin: 0; font-size: 10px; color: #aaaaaa; line-height: 1.5;">Connecting Jobs with Talent | 2026 Joblink. All Rights Reserved.</p>
</div>
</div>
</td>
</tr>
</tbody>
</table>
</body>
</html>`;
};

/**
 * Send verification code to email using Nodemailer
 */
const sendVerificationCode = async (email) => {
  try {
    console.log(`📧 Sending verification code to ${email}...`);
    
    // Check if SendGrid API key is loaded
    console.log(`🔍 SENDGRID_API_KEY: ${process.env.SENDGRID_API_KEY ? '✅ SET' : '❌ NOT SET'}`);

    // Check if email is valid format first - allow +, -, ., _ and numbers
    const emailRegex = /^[a-z0-9._+\-]+@gmail\.com$/i;
    if (!emailRegex.test(email)) {
      return {
        success: false,
        message: 'Invalid Gmail format'
      };
    }

    // Generate verification code
    const code = generateVerificationCode();
    const expiresAt = Date.now() + CODE_EXPIRY_TIME;

    // Store the pending verification
    pendingVerifications.set(email.toLowerCase(), {
      code,
      expiresAt,
      attempts: 0
    });

    // Verify SendGrid API key exists
    if (!process.env.SENDGRID_API_KEY) {
      console.error('❌ CRITICAL: SendGrid API key missing from .env file');
      return {
        success: false,
        message: 'Email service not configured. Missing SENDGRID_API_KEY in .env'
      };
    }

    // Initialize SendGrid with API key
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    // Get email template
    const emailTemplate = getEmailTemplate(code, email);
    
    // Get logo for email
    const logoBase64 = getLogoBase64();
    
    // Send verification email using SendGrid
    const msg = {
      to: email,
      from: {
        email: 'paltechjoblink@gmail.com',
        name: 'Joblink Team'
      },
      subject: 'Joblink Email Verification - Code: ' + code,
      html: emailTemplate,
      text: `Hello,\n\nYour Joblink email verification code is:\n\n${code}\n\nThis code is valid for 15 minutes and can only be used once.\n\nPlease don't share this code with anyone. Joblink support will never ask for your verification code.\n\nYou are receiving this email because a verification code was requested for you to be able to create Joblink account.\n\nIf you did not request this, ignore this email.\n\nBest regards,\nThe Joblink Team\n\n2026 Joblink. All rights reserved.`,
      replyTo: 'support@joblink.app',
      headers: {
        'X-Priority': '3 (Normal)',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'normal',
        'X-Mailer': 'Joblink',
        'List-Unsubscribe': '<mailto:support@joblink.app?subject=unsubscribe>',
        'Precedence': 'bulk'
      },
      attachments: logoBase64 ? [{
        content: logoBase64.split('base64,')[1],
        filename: 'logo.png',
        type: 'image/png',
        disposition: 'inline',
        contentId: 'logo'
      }] : []
    };

    await sgMail.send(msg);

    console.log(`✅ Verification code sent successfully to ${email}`);
    return {
      success: true,
      message: 'Verification code sent to your email. Check spam folder if not received in 1 minute.',
      expiresIn: '15 minutes',
      sentTo: email
    };

  } catch (emailError) {
    console.error(`❌ Email sending failed:`, emailError.message);
    console.error(`🔍 Full error details:`, JSON.stringify(emailError, null, 2));
    
    // Return detailed error for debugging
    return {
      success: false,
      message: 'Failed to send email. Please try again later.',
      error: emailError.message
    };
  }
};

/**
 * Verify the code entered by user
 */
const verifyCode = async (email, code) => {
  try {
    const normalizedEmail = email.toLowerCase();
    const verification = pendingVerifications.get(normalizedEmail);

    if (!verification) {
      return {
        verified: false,
        message: 'No verification code sent for this email. Request a new one.'
      };
    }

    // Check if code expired
    if (Date.now() > verification.expiresAt) {
      pendingVerifications.delete(normalizedEmail);
      return {
        verified: false,
        message: 'Verification code expired. Request a new one.'
      };
    }

    // Check attempt limit
    if (verification.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      pendingVerifications.delete(normalizedEmail);
      return {
        verified: false,
        message: 'Too many attempts. Request a new verification code.'
      };
    }

    // Increment attempts
    verification.attempts++;

    // Check if code matches
    if (code.trim() === verification.code) {
      pendingVerifications.delete(normalizedEmail);
      
      // Mark as verified
      verifiedEmails.set(normalizedEmail, {
        verified: true,
        verifiedAt: Date.now(),
        expiresAt: Date.now() + VERIFICATION_CACHE_TTL
      });

      console.log(`✅ Email verified: ${email}`);
      return {
        verified: true,
        message: 'Email verified successfully!'
      };
    }

    // Wrong code
    const attemptsLeft = MAX_VERIFICATION_ATTEMPTS - verification.attempts;
    return {
      verified: false,
      message: `Wrong code. ${attemptsLeft} attempts remaining.`,
      attemptsLeft
    };

  } catch (error) {
    console.error('❌ Code verification error:', error);
    return {
      verified: false,
      message: 'Verification failed: ' + error.message
    };
  }
};

/**
 * Main verification function - Format validation only
 * Real verification happens via email code
 */
const verifyGoogleEmail = async (email) => {
  const normalizedEmail = email.toLowerCase();
  
  console.log(`\n🔍 CHECKING EMAIL FORMAT: ${email}`);

  try {
    // Check if already verified
    const verified = verifiedEmails.get(normalizedEmail);
    if (verified && Date.now() < verified.expiresAt) {
      console.log(`✅ Email already verified!`);
      return {
        exists: true,
        verified: true,
        method: 'already-verified',
        email: email
      };
    }

    // Format check
    if (!normalizedEmail.endsWith('@gmail.com')) {
      return {
        exists: false,
        verified: false,
        method: 'not-gmail',
        email: email,
        reason: 'Only Gmail addresses are allowed'
      };
    }

    const [localPart, domain] = normalizedEmail.split('@');
    const localPartRegex = /^[a-z0-9._-]{1,64}$/;
    
    if (!localPartRegex.test(localPart)) {
      return {
        exists: false,
        verified: false,
        method: 'invalid-format',
        email: email,
        reason: 'Invalid Gmail username format'
      };
    }

    // Format is valid - return status
    const hasPendingCode = pendingVerifications.has(normalizedEmail);
    
    return {
      exists: true,
      verified: false,
      method: 'format-valid',
      email: email,
      requiresVerification: true,
      codeAlreadySent: hasPendingCode,
      message: hasPendingCode 
        ? 'Verification code already sent. Check your email.' 
        : 'Valid Gmail format. Send verification code to proceed.'
    };

  } catch (error) {
    console.error('❌ Format check error:', error);
    return {
      exists: false,
      verified: false,
      method: 'error',
      error: error.message
    };
  }
};

/**
 * Get cache stats for monitoring
 */
const getCacheStats = () => {
  return {
    pendingVerifications: pendingVerifications.size,
    verifiedEmails: verifiedEmails.size,
    pendingList: Array.from(pendingVerifications.keys()),
    verifiedList: Array.from(verifiedEmails.keys())
  };
};

module.exports = {
  verifyGoogleEmail,
  sendVerificationCode,
  verifyCode,
  getCacheStats,
  pendingVerifications,
  verifiedEmails
};
