-- User Registration System Schema
-- SQLite database for user accounts and associated features

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login INTEGER,
    CHECK (length(username) >= 3 AND length(username) <= 20)
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- User verified forwarding emails
CREATE TABLE IF NOT EXISTS user_forward_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    verified_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_forward_emails_user_id ON user_forward_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_forward_emails_email ON user_forward_emails(email);

-- User locked inboxes
CREATE TABLE IF NOT EXISTS user_locked_inboxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    inbox_address TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    locked_at INTEGER NOT NULL,
    last_accessed INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, inbox_address)
);

CREATE INDEX IF NOT EXISTS idx_locked_inboxes_user_id ON user_locked_inboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_locked_inboxes_address ON user_locked_inboxes(inbox_address);
CREATE INDEX IF NOT EXISTS idx_locked_inboxes_last_accessed ON user_locked_inboxes(last_accessed);

-- Trigger to enforce max 5 locked inboxes per user
CREATE TRIGGER IF NOT EXISTS check_locked_inbox_limit
BEFORE INSERT ON user_locked_inboxes
BEGIN
    SELECT RAISE(ABORT, 'User already has maximum number of locked inboxes')
    WHERE (SELECT COUNT(*) FROM user_locked_inboxes WHERE user_id = NEW.user_id) >= 5;
END;
