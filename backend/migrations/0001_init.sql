PRAGMA foreign_keys = ON;

CREATE TABLE invites (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_invites_token_hash
    ON invites(token_hash);

CREATE TABLE users (
    id TEXT PRIMARY KEY,

    -- An invitation can create at most one account.
    invite_id TEXT UNIQUE REFERENCES invites(id),

    created_at INTEGER NOT NULL
);

CREATE TABLE passkeys (
    credential_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- COSE public key encoded as base64url.
    public_key TEXT NOT NULL,

    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,

    device_type TEXT,
    backed_up INTEGER NOT NULL DEFAULT 0,

    created_at INTEGER NOT NULL,
    last_used_at INTEGER
);

CREATE INDEX idx_passkeys_user_id
    ON passkeys(user_id);

CREATE TABLE webauthn_challenges (
    id TEXT PRIMARY KEY,

    kind TEXT NOT NULL CHECK (
        kind IN ('registration', 'authentication')
    ),

    challenge TEXT NOT NULL,

    -- Registration flows know their future user ID before
    -- the account itself exists.
    user_id TEXT,

    invite_id TEXT REFERENCES invites(id),

    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_webauthn_challenges_expires_at
    ON webauthn_challenges(expires_at);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user_id
    ON sessions(user_id);

CREATE INDEX idx_sessions_expires_at
    ON sessions(expires_at);
