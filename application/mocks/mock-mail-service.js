/**
 * Mock Mail Service for UX Debug Mode
 * Provides sample emails without requiring IMAP/SMTP connections
 */

const Mail = require('../../domain/mail')
const EventEmitter = require('events')
const path = require('path')
const fs = require('fs')

// Clara's PGP Public Key
const CLARA_PGP_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mQENBGb92JcBCADNMGkl6x2e//Prbbyvlb3EE6BwfOdKpSa+70bJ8fsudlkas5VN
Iyuq6Kmuk8V9LD5qBL3e0SMe2x3K5xb+j0Wim/n0OIHkbdnAOtLqEbYMSAzL3keo
mqw5qbV47js3rxht9BZ2HYZm5GqOqLz4XuIomSS/EsDcuQDKVtKveE2nRkJUIORr
C+DNFcjgJc3yrF1bKE3KQz2ii7qNRH/ChKRXB+OS/7ZviQOSTlFVPGhjIxaI2sRI
Uw8U8pWPYyQzh+dpiA3OmzbF1/BB2AQOx98p975KTI4wmalF5PtsKnkFFZ1NPKC6
E6G0IIbDkEE1HBpEO4qmIuWd/tFyIP03EwL3ABEBAAG0G0NsYXJhIEsgPGNsYXJh
QGNyYXp5Y28ueHl6PokBSgQQAQgAHQUCZv3YlwQLCQcIAxUICgQWAAIBAhkBAhsD
Ah4BACEJEAGLYq6lsVaPFiEEmKN22IQaxMpTgI1sAYtirqWxVo8IOAf9HJglE8hQ
bqGtbCISKGOkeIq8TFr9A2MRaevNVQtf4o9TnzMi+9nFGfi6yniiceBz9oUWoXvt
ZkhEzc0Hn6PAX/sOW3r6wPu5gSaGjUJfd339aDasyZvdOoQ4cukcErIaFnAG7KmP
0Q7lyRp5K7dUmuc9b9dg5ngf+M8306dj/djHWCPtsaLJc7ExrfeT1lNA7MeY7DlE
9jdvm4hfwQZND16nXKKLZn/RZUkR5Zoo1LE+GSL0/GCFZeH1PnEt5kcI3QKyx9wn
+DlMcAZCVs2X5JzTbJQKr9Cwv1syOlaZmVeUTuKiTfAB71wINQkFHdmONIg0h9wp
ThTjXOlDsQvnP7kBDQRm/diXAQgAg8BaBpL//o62UrrbQ79WbVzVTH+2f+xVD8bE
tyEL1QjllFfPdc5oT9nQ5RPfN6IJpbN0/p688pQa10gFgjEN0WtI51Vda/PQ1FQ8
q1xXbH6zJXP3FAPEPTId4Rw7Gb+vaUaBo3O0ZyKpAxzEy2gIvXz2ChfL6ENn5QZ/
1DsBeQQE3YbgG+jXAL//JGjINoppOTCfnEMlKaZYdkLvA2KiJKqtD+JDTVFkdk02
1Jext8Td6wkd72i0+DQI9RaJJr5oDXlxAN0iX4OMSdo35e2Mj4AktjvO8JzRvZjU
uPCGYH9DpVoB0OCNRmD/2CeUyQgiehk8NHXLxf8h1duTGZYYRQARAQABiQE2BBgB
CAAJBQJm/diXAhsMACEJEAGLYq6lsVaPFiEEmKN22IQaxMpTgI1sAYtirqWxVo/R
cQgAmJ0taRUkOmoepQR6JNJejF1JiITQy5eSvZzXDBoEWip4fcl4FRAy5yz6s/sC
NtweWyWMg3+lu+s7qh3r1Qw5EN7ukgUy+fvk6xY3TBxcJ1aC/KvKbaeTrZt0Bt6U
sQipNDI/cPkL2ILzqt/shEgj9g/EWARe1X5SQ0nEhCYLi7xZV9lBe3dU+EUlmwSe
gmxppMfACd9hyVV4SbO6l5NKmXgkYWNMzFzjfg3pxAPuJjaaYN85XETqpKwdfPRt
KUPuyh+UdOt8GPRBcFxjRJQrBRw2nBJxCCEJOJAJJ2ySpHQBwpaXsK0WW2SGkaxF
ggOCb56KkepgTvU3Xdv5opRZAg==
=HEe7
-----END PGP PUBLIC KEY BLOCK-----`

class MockMailService extends EventEmitter {
    constructor(config) {
        super()
        this.config = config
        this.mockEmails = this._generateMockEmails()
        this.logoAttachment = this._getLogoAttachment()
    }

    _getLogoAttachment() {
        // Try to read the service logo
        const logoPath = path.join(__dirname, '../infrastructure/web/public/images/logo.png')
        if (fs.existsSync(logoPath)) {
            return {
                filename: '48hr-email-logo.png',
                content: fs.readFileSync(logoPath),
                contentType: 'image/png'
            }
        }
        return null
    }

    _generateMockEmails() {
        const domain = this.config.email.domains[0]
        const now = new Date()
        const earlier = new Date(now.getTime() - 3600000) // 1 hour ago

        return [{
                mail: Mail.create(
                    [`demo@${domain}`], [{ name: 'Clara K', address: 'clara@crazyco.xyz' }],
                    earlier.toISOString(),
                    'Welcome to 48hr.email - Plain Text Demo',
                    1
                ),
                fullMail: {
                    text: `Hello from 48hr.email!

This is a plain text demonstration email for UX debugging purposes.

48hr.email is your favorite open-source temporary email service, created by ClaraCrazy.

Features:
- Disposable email addresses
- No registration required
- Auto-delete after configured time
- Open source (GPL-3.0)
- Self-hostable

For more information, visit: https://48hr.email
GitHub: https://github.com/Crazyco-xyz/48hr.email
Discord: https://discord.gg/crazyco

---
Clara's PGP Public Key:

${CLARA_PGP_KEY}

---

This is a mock email generated for UX debug mode.
No actual IMAP or SMTP connections were used.`,
                    textAsHtml: `<p>Hello from 48hr.email!</p>
<p>This is a plain text demonstration email for UX debugging purposes.</p>
<p>48hr.email is your favorite open-source temporary email service, created by ClaraCrazy.</p>
<p>Features:<br/>
- Disposable email addresses<br/>
- No registration required<br/>
- Auto-delete after configured time<br/>
- Open source (GPL-3.0)<br/>
- Self-hostable</p>
<p>For more information, visit: <a href="https://48hr.email">https://48hr.email</a><br/>
GitHub: <a href="https://github.com/Crazyco-xyz/48hr.email">https://github.com/Crazyco-xyz/48hr.email</a><br/>
Discord: <a href="https://discord.gg/crazyco">https://discord.gg/crazyco</a></p>
<p>---<br/>
Clara's PGP Public Key:</p>
<pre style="background: #1a1a1a; color: #666; padding: 12px; border-radius: 6px; border: 1px solid rgba(155, 77, 202, 0.2);">${CLARA_PGP_KEY}</pre>
<p>---</p>
<p>This is a mock email generated for UX debug mode.<br/>
No actual IMAP or SMTP connections were used.</p>`,
                    html: null,
                    subject: 'Welcome to 48hr.email - Plain Text Demo',
                    from: { text: 'Clara K <clara@crazyco.xyz>' },
                    to: { text: `demo@${domain}` },
                    date: earlier,
                    attachments: this.logoAttachment ? [this.logoAttachment] : []
                }
            },
            {
                mail: Mail.create(
                    [`demo@${domain}`], [{ name: '48hr.email', address: 'noreply@48hr.email' }],
                    now.toISOString(),
                    'HTML Email Demo - Features Overview',
                    2
                ),
                fullMail: {
                    text: `48hr.email - HTML Email Demo

This is the plain text version of the HTML email.

Visit https://48hr.email for more information.

Clara's PGP Key is attached to this email.`,
                    html: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.5;
            color: #e0e0e0;
            background: #131516;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid rgba(155, 77, 202, 0.3);
        }
        h1 {
            color: #9b4dca;
            font-size: 2rem;
            margin: 0;
            font-weight: 600;
        }
        .subtitle {
            color: #888;
            font-size: 0.95rem;
            margin: 0;
        }
        .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }
        .section {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            padding: 15px;
        }
        h2 {
            color: #9b4dca;
            font-size: 1.2rem;
            margin: 0 0 10px 0;
            font-weight: 500;
        }
        p {
            margin: 0 0 10px 0;
            color: #cccccc;
            font-size: 0.95rem;
        }
        .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin: 10px 0 0 0;
        }
        .feature-item {
            padding: 6px 10px;
            background: rgba(155, 77, 202, 0.08);
            border-radius: 4px;
            font-size: 0.9rem;
            color: #cccccc;
        }
        .pgp-key {
            background: #1a1a1a;
            border: 1px solid rgba(155, 77, 202, 0.2);
            border-radius: 6px;
            padding: 12px;
            font-family: 'Courier New', monospace;
            font-size: 0.65rem;
            color: #666;
            overflow-x: auto;
            white-space: pre;
            line-height: 1.3;
            max-height: 180px;
            overflow-y: auto;
        }
        .footer {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            text-align: center;
            color: #666;
            font-size: 0.85rem;
        }
        a {
            color: #9b4dca;
            text-decoration: none;
        }
        a:hover {
            color: #b366e6;
        }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>48hr.email</h1>
            <p class="subtitle">Temporary inbox, no registration</p>
        </div>
    </div>
    
    <div class="grid">
        <div class="section">
            <h2>About</h2>
            <p>Open-source temporary email service. Create disposable addresses instantly and receive emails without registration. Emails auto-delete after the configured purge time.</p>
        </div>
        
        <div class="section">
            <h2>Features</h2>
            <div class="feature-grid">
                <div class="feature-item">Instant addresses</div>
                <div class="feature-item">No registration</div>
                <div class="feature-item">Real-time updates</div>
                <div class="feature-item">HTML rendering</div>
                <div class="feature-item">Open source GPL-3.0</div>
                <div class="feature-item">Self-hostable</div>
            </div>
        </div>
    </div>
    
    <div class="section">
        <h2>Developer PGP Key (ClaraCrazy)</h2>
        <div class="pgp-key">${CLARA_PGP_KEY}</div>
    </div>
    
    <div class="footer">
        <p><strong>48hr.email</strong> by <a href="https://crazyco.xyz">ClaraCrazy</a> &middot; <a href="https://github.com/Crazyco-xyz/48hr.email">GitHub</a> &middot; <a href="https://discord.gg/crazyco">Discord</a> &middot; UX Debug Mode</p>
    </div>
</body>
</html>`,
                    subject: 'HTML Email Demo - Features Overview',
                    from: { text: '48hr.email <noreply@48hr.email>' },
                    to: { text: `demo@${domain}` },
                    date: now,
                    attachments: this.logoAttachment ? [this.logoAttachment] : []
                }
            }
        ]
    }

    async connectAndLoadMessages() {
        // Simulate async loading
        await new Promise(resolve => setTimeout(resolve, 500))

        // Emit initial load event
        this.emit('initial load done')

        return Promise.resolve()
    }

    getMockEmails() {
        return this.mockEmails
    }

    async fetchOneFullMail(to, uid, raw = false) {
        const email = this.mockEmails.find(e => e.mail.uid === parseInt(uid))
        if (!email) {
            throw new Error(`Mock email with UID ${uid} not found`)
        }

        // If raw is requested, return a string representation
        if (raw) {
            const mail = email.fullMail
            const headers = [
                `From: ${mail.from.text}`,
                `To: ${mail.to.text}`,
                `Date: ${mail.date}`,
                `Subject: ${mail.subject}`,
                `Content-Type: ${mail.html ? 'text/html; charset=UTF-8' : 'text/plain; charset=UTF-8'}`,
                '',
                mail.html || mail.text || ''
            ]
            return headers.join('\n')
        }

        return email.fullMail
    }

    // Stub methods for compatibility
    deleteMessage() {
        return Promise.resolve()
    }

    deleteOldMails() {
        return Promise.resolve()
    }

    closeBox() {
        return Promise.resolve()
    }

    getSecondsUntilNextRefresh() {
        // In mock mode, return null (no refresh needed)
        return null
    }

    async getLargestUid() {
        // Return the largest UID from mock emails
        const mockEmails = this.getMockEmails()
        if (mockEmails.length === 0) return null
        return Math.max(...mockEmails.map(e => e.mail.uid))
    }

    on(event, handler) {
        return super.on(event, handler)
    }
}

MockMailService.EVENT_INITIAL_LOAD_DONE = 'initial load done'
MockMailService.EVENT_NEW_MAIL = 'mail'
MockMailService.EVENT_DELETED_MAIL = 'mailDeleted'
MockMailService.EVENT_ERROR = 'error'

module.exports = MockMailService
