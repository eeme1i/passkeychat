PRAGMA foreign_keys = OFF;

ALTER TABLE passkeys ADD COLUMN name TEXT;

CREATE TABLE webauthn_challenges_new (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (
        kind IN ('registration', 'passkey_registration', 'authentication')
    ),
    challenge TEXT NOT NULL,
    user_id TEXT,
    invite_id TEXT REFERENCES invites(id),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

INSERT INTO webauthn_challenges_new (
    id, kind, challenge, user_id, invite_id, expires_at, created_at
)
SELECT id, kind, challenge, user_id, invite_id, expires_at, created_at
FROM webauthn_challenges;

DROP TABLE webauthn_challenges;
ALTER TABLE webauthn_challenges_new RENAME TO webauthn_challenges;

CREATE INDEX idx_webauthn_challenges_expires_at
    ON webauthn_challenges(expires_at);

PRAGMA foreign_keys = ON;
