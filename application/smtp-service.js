const nodemailer = require('nodemailer')
const debug = require('debug')('48hr-email:smtp-service')

/**
 * SMTP Service for forwarding emails
 * Uses nodemailer to send forwarded emails via configured SMTP server
 */
class SmtpService {
    constructor(config) {
        this.config = config
        this.transporter = null

        // Only initialize transporter if SMTP is configured
        if (this._isConfigured()) {
            this._initializeTransporter()
        } else {
            debug('SMTP not configured - forwarding functionality will be unavailable')
        }
    }

    /**
     * Check if SMTP is properly configured
     * @returns {boolean}
     */
    _isConfigured() {
        return !!(
            this.config.smtp.enabled &&
            this.config.smtp.host &&
            this.config.smtp.user &&
            this.config.smtp.password
        )
    }

    /**
     * Initialize the nodemailer transporter
     * @private
     */
    _initializeTransporter() {
        try {
            this.transporter = nodemailer.createTransport({
                host: this.config.smtp.host,
                port: this.config.smtp.port,
                secure: this.config.smtp.secure,
                auth: {
                    user: this.config.smtp.user,
                    pass: this.config.smtp.password
                },
                tls: {
                    // Allow self-signed certificates and skip verification
                    // This is useful for development or internal SMTP servers
                    rejectUnauthorized: false
                }
            })

            debug(`SMTP transporter initialized: ${this.config.smtp.host}:${this.config.smtp.port}`)
        } catch (error) {
            debug('Failed to initialize SMTP transporter:', error.message)
            throw new Error(`SMTP initialization failed: ${error.message}`)
        }
    }

    /**
     * Forward an email to a destination address
     * @param {Object} mail - Parsed email object from mailparser
     * @param {string} destinationEmail - Email address to forward to
     * @returns {Promise<{success: boolean, error?: string, messageId?: string}>}
     */
    async forwardMail(mail, destinationEmail, branding = '48hr.email') {
        if (!this.transporter) {
            return {
                success: false,
                error: 'SMTP is not configured. Please configure SMTP settings to enable forwarding.'
            }
        }

        if (!mail) {
            return {
                success: false,
                error: 'Email not found'
            }
        }

        try {
            debug(`Forwarding email (Subject: "${mail.subject}") to ${destinationEmail}`)

            const forwardMessage = this._buildForwardMessage(mail, destinationEmail, branding)

            const info = await this.transporter.sendMail(forwardMessage)

            debug(`Email forwarded successfully. MessageId: ${info.messageId}`)

            return {
                success: true,
                messageId: info.messageId
            }
        } catch (error) {
            debug('Failed to forward email:', error.message)
            return {
                success: false,
                error: `Failed to send email: ${error.message}`
            }
        }
    }

    /**
     * Build the forward message structure
     * @param {Object} mail - Parsed email object
     * @param {string} destinationEmail - Destination address
     * @param {string} branding - Service branding name
     * @returns {Object} - Nodemailer message object
     * @private
     */
    _buildForwardMessage(mail, destinationEmail, branding = '48hr.email') {
        // Extract original sender info
        const originalFrom = (mail.from && mail.from.text) || 'Unknown Sender'
        const originalTo = (mail.to && mail.to.text) || 'Unknown Recipient'
        const originalDate = mail.date ? new Date(mail.date).toLocaleString() : 'Unknown Date'
        const originalSubject = mail.subject || '(no subject)'

        // Build forwarded message body
        let forwardedBody = `
---------- Forwarded message ----------
From: ${originalFrom}
Date: ${originalDate}
Subject: ${originalSubject}
To: ${originalTo}


`

        // Add original text body if available
        if (mail.text) {
            forwardedBody += mail.text
        } else if (mail.html) {
            // If only HTML is available, mention it
            forwardedBody += '[This email contains HTML content. See attachment or HTML version below.]\n\n'
        }

        // Build the message object
        const message = {
            from: {
                name: branding,
                address: this.config.smtp.user
            },
            to: destinationEmail,
            subject: `Fwd: ${originalSubject}`,
            text: forwardedBody,
            replyTo: originalFrom
        }

        // Add HTML body if available
        if (mail.html) {
            const htmlForwardedBody = `
<div style="border-left: 2px solid #ccc; padding-left: 10px; margin: 10px 0;">
    <p><strong>---------- Forwarded message ----------</strong><br>
    <strong>From:</strong> ${this._escapeHtml(originalFrom)}<br>
    <strong>Date:</strong> ${this._escapeHtml(originalDate)}<br>
    <strong>Subject:</strong> ${this._escapeHtml(originalSubject)}<br>
    <strong>To:</strong> ${this._escapeHtml(originalTo)}</p>
</div>
${mail.html}
`
            message.html = htmlForwardedBody
        }

        // Add attachments if present
        if (mail.attachments && mail.attachments.length > 0) {
            message.attachments = mail.attachments.map(att => ({
                filename: att.filename || 'attachment',
                content: att.content,
                contentType: att.contentType,
                contentDisposition: att.contentDisposition || 'attachment'
            }))

            debug(`Including ${mail.attachments.length} attachment(s) in forwarded email`)
        }

        return message
    }

    /**
     * Simple HTML escape for email headers
     * @param {string} text
     * @returns {string}
     * @private
     */
    _escapeHtml(text) {
        if (!text) return ''
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
    }

    /**
     * Verify SMTP connection
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async verifyConnection() {
        if (!this.transporter) {
            return {
                success: false,
                error: 'SMTP is not configured'
            }
        }

        try {
            await this.transporter.verify()
            debug('SMTP connection verified successfully')
            return { success: true }
        } catch (error) {
            debug('SMTP connection verification failed:', error.message)
            return {
                success: false,
                error: error.message
            }
        }
    }

    /**
     * Send verification email to destination address
     * @param {string} destinationEmail - Email address to verify
     * @param {string} token - Verification token
     * @param {string} baseUrl - Base URL for verification link
     * @param {string} branding - Service branding name
     * @param {string} verifyPath - Verification path (default: /inbox/verify)
     * @returns {Promise<{success: boolean, error?: string, messageId?: string}>}
     */
    async sendVerificationEmail(destinationEmail, token, baseUrl, branding = '48hr.email', verifyPath = '/inbox/verify') {
        if (!this.transporter) {
            return {
                success: false,
                error: 'SMTP is not configured. Please configure SMTP settings to enable forwarding.'
            }
        }

        const verificationLink = `${baseUrl}${verifyPath}?token=${token}`

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2c3e50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; }
        .button { display: inline-block; background: #3498db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
        .button:hover { background: #2980b9; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 0.9em; }
        code { background: #e8e8e8; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
    </style>
</head>
<body>
    <div class="header">
        <h2>🔐 Verify Your Email Address</h2>
    </div>
    <div class="content">
        <p>Hello,</p>
        
        <p>You requested to use <strong>${this._escapeHtml(destinationEmail)}</strong> as a forwarding destination on <strong>${this._escapeHtml(branding)}</strong>.</p>
        
        <p>To verify ownership of this email address and enable forwarding for 24 hours, please click the button below:</p>
        
        <div style="text-align: center;">
            <a href="${verificationLink}" class="button">Verify Email Address</a>
        </div>
        
        <p>Or copy and paste this link into your browser:</p>
        <p><code>${verificationLink}</code></p>
        
        <div class="warning">
            <strong>Important:</strong> This verification link expires in <strong>15 minutes</strong>. Once verified, you'll be able to forward emails to this address for 24 hours.
        </div>
        
        <p>If you didn't request this verification, you can safely ignore this email.</p>
    </div>
    <div class="footer">
        <p>This is an automated message from ${this._escapeHtml(branding)}</p>
    </div>
</body>
</html>
`

        const textContent = `
Verify Your Email Address

You requested to use ${destinationEmail} as a forwarding destination on ${branding}.

To verify ownership of this email address and enable forwarding for 24 hours, please visit:

${verificationLink}

IMPORTANT: This verification link expires in 15 minutes. Once verified, you'll be able to forward emails to this address for 24 hours.

If you didn't request this verification, you can safely ignore this email.

---
This is an automated message from ${branding}
`

        try {
            const info = await this.transporter.sendMail({
                from: `"${branding} Forwarding Service" <${this.config.smtp.user}>`,
                to: destinationEmail,
                subject: `${branding} - Verify your email for forwarding`,
                text: textContent,
                html: htmlContent
            })

            debug(`Verification email sent to ${destinationEmail}, messageId: ${info.messageId}`)
            return {
                success: true,
                messageId: info.messageId
            }
        } catch (error) {
            debug(`Failed to send verification email: ${error.message}`)
            return {
                success: false,
                error: `Failed to send verification email: ${error.message}`
            }
        }
    }
}

module.exports = SmtpService
