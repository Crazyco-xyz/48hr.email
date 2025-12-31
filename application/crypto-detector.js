const debug = require('debug')('48hr-email:crypto-detector')

/**
 * Detects cryptographic keys and signatures in email attachments
 */
class CryptoDetector {
    constructor() {
        // Common cryptographic file extensions
        this.cryptoExtensions = [
            '.pgp', '.gpg', '.asc', '.pub', '.key', '.pem',
            '.crt', '.cer', '.sig', '.sign', '.p7s', '.p7m',
            '.pkcs7', '.pkcs12', '.pfx', '.p12'
        ]

        // Patterns to detect key blocks in content
        this.keyPatterns = [
            // PGP/GPG keys
            /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/g,
            /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
            /-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/g,
            /-----BEGIN PGP SIGNATURE-----[\s\S]*?-----END PGP SIGNATURE-----/g,

            // SSH keys
            /-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----[\s\S]*?-----END (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/g,
            /ssh-(rsa|dss|ed25519|ecdsa) [A-Za-z0-9+/=]+/g,

            // SSL/TLS certificates and keys
            /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
            /-----BEGIN (RSA|EC) PRIVATE KEY-----[\s\S]*?-----END (RSA|EC) PRIVATE KEY-----/g,
            /-----BEGIN ENCRYPTED PRIVATE KEY-----[\s\S]*?-----END ENCRYPTED PRIVATE KEY-----/g,
            /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g,

            // PKCS7/CMS signatures
            /-----BEGIN PKCS7-----[\s\S]*?-----END PKCS7-----/g,
        ]
    }

    /**
     * Checks if a filename suggests a cryptographic file
     * @param {string} filename 
     * @returns {boolean}
     */
    isCryptoFilename(filename) {
        if (!filename) return false
        const lowerName = filename.toLowerCase()
        return this.cryptoExtensions.some(ext => lowerName.endsWith(ext)) ||
            lowerName.includes('signature') ||
            lowerName.includes('publickey') ||
            lowerName.includes('privatekey') ||
            lowerName.includes('certificate')
    }

    /**
     * Detects the type of cryptographic content
     * @param {string} content 
     * @param {string} filename 
     * @returns {string|null} The detected key type or null
     */
    detectKeyType(content, filename) {
        if (!content) return null

        const contentStr = content.toString('utf8', 0, Math.min(content.length, 10000)) // Check first 10KB

        if (contentStr.includes('BEGIN PGP PUBLIC KEY')) return 'PGP Public Key'
        if (contentStr.includes('BEGIN PGP PRIVATE KEY')) return 'PGP Private Key'
        if (contentStr.includes('BEGIN PGP MESSAGE')) return 'PGP Encrypted Message'
        if (contentStr.includes('BEGIN PGP SIGNATURE')) return 'PGP Signature'
        if (contentStr.match(/ssh-(rsa|dss|ed25519|ecdsa)/)) return 'SSH Public Key'
        if (contentStr.includes('BEGIN RSA PRIVATE KEY')) return 'RSA Private Key'
        if (contentStr.includes('BEGIN EC PRIVATE KEY')) return 'EC Private Key'
        if (contentStr.includes('BEGIN OPENSSH PRIVATE KEY')) return 'OpenSSH Private Key'
        if (contentStr.includes('BEGIN CERTIFICATE')) return 'X.509 Certificate'
        if (contentStr.includes('BEGIN PUBLIC KEY')) return 'Public Key'
        if (contentStr.includes('BEGIN ENCRYPTED PRIVATE KEY')) return 'Encrypted Private Key'
        if (contentStr.includes('BEGIN PKCS7')) return 'PKCS#7 Signature'

        // Check by filename if content detection fails
        if (filename) {
            const lower = filename.toLowerCase()
            if (lower.endsWith('.pub')) return 'Public Key'
            if (lower.endsWith('.sig') || lower.endsWith('.sign')) return 'Detached Signature'
            if (lower.endsWith('.asc')) return 'ASCII Armored Key/Signature'
            if (lower.endsWith('.pgp') || lower.endsWith('.gpg')) return 'PGP Key/Message'
            if (lower.endsWith('.pem')) return 'PEM Encoded Key/Certificate'
            if (lower.endsWith('.crt') || lower.endsWith('.cer')) return 'Certificate'
        }

        return null
    }

    /**
     * Extracts cryptographic keys from content
     * @param {string|Buffer} content 
     * @returns {Array<{type: string, content: string}>}
     */
    extractKeys(content) {
        if (!content) return []

        const contentStr = content.toString('utf8')
        const keys = []

        this.keyPatterns.forEach(pattern => {
            const matches = contentStr.match(pattern)
            if (matches) {
                matches.forEach(match => {
                    // Determine key type from the match
                    let type = 'Cryptographic Key'
                    if (match.includes('PGP PUBLIC KEY')) type = 'PGP Public Key'
                    else if (match.includes('PGP PRIVATE KEY')) type = 'PGP Private Key'
                    else if (match.includes('PGP MESSAGE')) type = 'PGP Message'
                    else if (match.includes('PGP SIGNATURE')) type = 'PGP Signature'
                    else if (match.includes('ssh-')) type = 'SSH Public Key'
                    else if (match.includes('CERTIFICATE')) type = 'Certificate'
                    else if (match.includes('PUBLIC KEY')) type = 'Public Key'
                    else if (match.includes('PRIVATE KEY')) type = 'Private Key'

                    keys.push({
                        type,
                        content: match
                    })
                })
            }
        })

        return keys
    }

    /**
     * Processes email attachments to detect and extract cryptographic content
     * @param {Array} attachments - Array of email attachments
     * @returns {Array<{filename: string, type: string, content: string, preview: string}>}
     */
    detectCryptoAttachments(attachments) {
        if (!attachments || !Array.isArray(attachments)) {
            return []
        }

        const cryptoFiles = []

        attachments.forEach(attachment => {
            // Check if it's a potential crypto file
            if (this.isCryptoFilename(attachment.filename)) {
                const keyType = this.detectKeyType(attachment.content, attachment.filename)

                if (keyType) {
                    // Extract actual keys from content
                    const extractedKeys = this.extractKeys(attachment.content)

                    if (extractedKeys.length > 0) {
                        extractedKeys.forEach(key => {
                            cryptoFiles.push({
                                filename: attachment.filename,
                                type: key.type,
                                content: key.content,
                                preview: this._generatePreview(key.content, key.type),
                                info: this._extractKeyInfo(key.content, key.type)
                            })
                        })
                    } else {
                        // File has crypto extension/name but no extractable key blocks
                        // Still show it as it might be binary encoded
                        const contentStr = attachment.content.toString('utf8', 0, Math.min(attachment.content.length, 500))
                        cryptoFiles.push({
                            filename: attachment.filename,
                            type: keyType,
                            content: contentStr + (attachment.content.length > 500 ? '\n...[truncated]' : ''),
                            preview: this._generatePreview(contentStr, keyType),
                            info: this._extractKeyInfo(contentStr, keyType)
                        })
                    }
                }
            }
        })

        debug(`Detected ${cryptoFiles.length} cryptographic files in attachments`)
        return cryptoFiles
    }

    /**
     * Extract specific information from the key content
     * @param {string} content 
     * @param {string} type 
     * @returns {string}
     * @private
     */
    _extractKeyInfo(content, type) {
        if (!content) return ''

        // For SSH keys, extract the key comment/user
        if (type.includes('SSH')) {
            const sshMatch = content.match(/ssh-\S+\s+\S+\s+(.+?)[\r\n]/)
            if (sshMatch && sshMatch[1] && sshMatch[1].trim()) {
                return sshMatch[1].trim()
            }
            // Show algorithm if available
            const algoMatch = content.match(/ssh-(rsa|dss|ed25519|ecdsa-sha2-nistp(\d+))/)
            if (algoMatch) {
                return `${algoMatch[1].toUpperCase()}`
            }
        }

        // For PGP keys and signatures, extract user info
        if (type.includes('PGP')) {
            // For signatures, try to extract key ID from the signature packet
            if (type.includes('Signature')) {
                try {
                    // Extract base64 content
                    const lines = content.split('\n')
                    let base64Content = ''
                    let inSig = false

                    for (const line of lines) {
                        if (line.includes('BEGIN PGP')) {
                            inSig = true
                            continue
                        }
                        if (line.includes('END PGP')) {
                            break
                        }
                        if (inSig && line.trim() && !line.startsWith('=')) {
                            base64Content += line.trim()
                        }
                    }

                    if (base64Content) {
                        const decoded = Buffer.from(base64Content, 'base64')

                        // Try to find key ID in signature packet
                        // OpenPGP signature packets typically have key ID at specific offsets
                        // Look for 8-byte key ID patterns
                        for (let i = 0; i < decoded.length - 8; i++) {
                            // Check if this looks like a key ID section
                            // Key IDs are often preceded by specific packet headers
                            if (decoded[i] === 0x00 && i + 8 < decoded.length) {
                                const keyIdBytes = decoded.slice(i + 1, i + 9)
                                const keyId = keyIdBytes.toString('hex').toUpperCase()

                                // Validate it looks like a reasonable key ID (not all zeros, not all FFs)
                                if (keyId.match(/^[0-9A-F]{16}$/) &&
                                    keyId !== '0000000000000000' &&
                                    keyId !== 'FFFFFFFFFFFFFFFF') {
                                    return `Key ID: ${keyId.slice(-16)}`
                                }
                            }
                        }

                        // Alternative: look for the issuer key ID in a more reliable way
                        // The key ID is usually in the last 8 bytes before certain markers
                        if (decoded.length > 20) {
                            // Try to extract from common positions
                            const possibleKeyId = decoded.slice(decoded.length - 20, decoded.length - 12).toString('hex').toUpperCase()
                            if (possibleKeyId.match(/^[0-9A-F]{16}$/)) {
                                return `Key ID: ${possibleKeyId}`
                            }
                        }
                    }
                } catch (err) {
                    debug(`Error extracting signature key ID: ${err.message}`)
                }
                return 'PGP detached signature'
            }

            // For keys, extract user info
            try {
                // Extract base64 content between BEGIN and END lines
                const lines = content.split('\n')
                let base64Content = ''
                let inKey = false

                for (const line of lines) {
                    if (line.includes('BEGIN PGP')) {
                        inKey = true
                        continue
                    }
                    if (line.includes('END PGP')) {
                        break
                    }
                    if (inKey && line.trim() && !line.startsWith('=')) {
                        base64Content += line.trim()
                    }
                }

                if (base64Content) {
                    // Decode base64 to binary buffer
                    const decoded = Buffer.from(base64Content, 'base64')

                    // Extract printable ASCII strings from the buffer
                    let printableStr = ''
                    for (let i = 0; i < decoded.length; i++) {
                        const byte = decoded[i]
                            // Keep printable ASCII characters
                        if (byte >= 0x20 && byte <= 0x7E) {
                            printableStr += String.fromCharCode(byte)
                        } else {
                            // Add separator for non-printable bytes
                            if (printableStr.length > 0 && !printableStr.endsWith('|')) {
                                printableStr += '|'
                            }
                        }
                    }

                    debug(`Extracted printable from PGP: ${printableStr.substring(0, 200)}`)

                    // Look for email with optional name before it
                    const emailPattern = /([A-Za-z][A-Za-z\s]{0,40}?)<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/
                    const emailMatch = printableStr.match(emailPattern)
                    if (emailMatch) {
                        const name = emailMatch[1].replace(/\|/g, '').trim()
                        const email = emailMatch[2]
                        debug(`Found PGP user: ${name} <${email}>`)
                        if (name.length > 0) {
                            return `${name} <${email}>`
                        }
                        return email
                    }

                    // Just look for bare email
                    const bareEmailMatch = printableStr.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
                    if (bareEmailMatch) {
                        debug(`Found PGP email: ${bareEmailMatch[1]}`)
                        return bareEmailMatch[1]
                    }
                }
            } catch (err) {
                debug(`Error extracting PGP info: ${err.message}`)
            }
            return ''
        }

        // For detached signatures, show signature type
        if (type.includes('Signature')) {
            if (type.includes('PKCS')) {
                return 'PKCS#7/CMS signature'
            }
            return 'Detached signature'
        }

        // For certificates, extract subject Common Name or issuer
        if (type.includes('Certificate')) {
            const cnPatterns = [
                /CN\s*=\s*([^,\n/]+)/,
                /commonName\s*=\s*([^,\n/]+)/i,
                /Subject:.*?CN\s*=\s*([^,\n/]+)/
            ]
            for (const pattern of cnPatterns) {
                const match = content.match(pattern)
                if (match && match[1]) {
                    return match[1].trim()
                }
            }
        }

        // For private keys, check encryption
        if (type.includes('Private')) {
            if (content.includes('ENCRYPTED') || content.includes('Proc-Type: 4,ENCRYPTED')) {
                return 'Encrypted'
            }
        }

        return ''
    }

    /**
     * Generates a preview/fingerprint for the key
     * @param {string} content 
     * @param {string} type 
     * @returns {string}
     * @private
     */
    _generatePreview(content, type) {
        if (!content) return ''

        // For SSH keys, extract the key comment if available
        if (type.includes('SSH')) {
            const sshMatch = content.match(/ssh-\S+\s+\S+\s+(.+)/)
            if (sshMatch && sshMatch[1]) {
                return `Comment: ${sshMatch[1].trim()}`
            }
        }

        // For PGP keys, try to extract key ID or user info
        if (type.includes('PGP')) {
            // This is a simplified preview - proper parsing would require OpenPGP library
            const lines = content.split('\n')
            const infoLines = lines.filter(line =>
                line.includes('User-ID') ||
                line.includes('Key-ID') ||
                line.includes('Fingerprint')
            )
            if (infoLines.length > 0) {
                return infoLines.slice(0, 2).join(', ')
            }
        }

        // For certificates, try to extract subject/issuer
        if (type.includes('Certificate')) {
            const subjectMatch = content.match(/Subject:.*?CN=([^,\n]+)/)
            const issuerMatch = content.match(/Issuer:.*?CN=([^,\n]+)/)
            const parts = []
            if (subjectMatch) parts.push(`Subject: ${subjectMatch[1]}`)
            if (issuerMatch) parts.push(`Issuer: ${issuerMatch[1]}`)
            if (parts.length > 0) return parts.join(', ')
        }

        // Generic preview: show first and last few characters
        const preview = content.replace(/[\r\n]+/g, ' ').slice(0, 100)
        return preview.length < content.length ? preview + '...' : preview
    }
}

module.exports = CryptoDetector