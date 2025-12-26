const Database = require('better-sqlite3')
const bcrypt = require('bcrypt')
const path = require('path')

class InboxLock {
    constructor(dbPath = './db/locked-inboxes.db') {
        // Ensure data directory exists
        const fs = require('fs')
        const dir = path.dirname(dbPath)
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }

        this.db = new Database(dbPath)
        this.db.pragma('journal_mode = WAL')
        this._initTable()
    }

    _initTable() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS locked_inboxes (
                address TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                locked_at INTEGER NOT NULL,
                last_access INTEGER NOT NULL
            )
        `)
    }

    async lock(address, password) {
        const passwordHash = await bcrypt.hash(password, 10)
        const now = Date.now()

        const stmt = this.db.prepare(`
            INSERT INTO locked_inboxes (address, password_hash, locked_at, last_access)
            VALUES (?, ?, ?, ?)
        `)

        try {
            stmt.run(address.toLowerCase(), passwordHash, now, now)
            return true
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new Error('This inbox is already locked')
            }
            throw error
        }
    }

    async unlock(address, password) {
        const stmt = this.db.prepare('SELECT * FROM locked_inboxes WHERE address = ?')
        const inbox = stmt.get(address.toLowerCase())

        if (!inbox) {
            return null
        }

        const valid = await bcrypt.compare(password, inbox.password_hash)
        if (!valid) {
            return null
        }

        // Update last access
        this.updateAccess(address)
        return inbox
    }

    isLocked(address) {
        const stmt = this.db.prepare('SELECT address FROM locked_inboxes WHERE address = ?')
        return stmt.get(address.toLowerCase()) !== undefined
    }

    updateAccess(address) {
        const stmt = this.db.prepare('UPDATE locked_inboxes SET last_access = ? WHERE address = ?')
        stmt.run(Date.now(), address.toLowerCase())
    }

    getInactive(hoursThreshold) {
        const cutoff = Date.now() - (hoursThreshold * 60 * 60 * 1000)
        const stmt = this.db.prepare('SELECT address FROM locked_inboxes WHERE last_access < ?')
        return stmt.all(cutoff).map(row => row.address)
    }

    release(address) {
        const stmt = this.db.prepare('DELETE FROM locked_inboxes WHERE address = ?')
        stmt.run(address.toLowerCase())
    }

    getAllLocked() {
        const stmt = this.db.prepare('SELECT address FROM locked_inboxes')
        return stmt.all().map(row => row.address)
    }
}

module.exports = InboxLock