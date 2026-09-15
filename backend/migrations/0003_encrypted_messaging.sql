PRAGMA foreign_keys = ON;

CREATE TABLE messaging_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);
CREATE INDEX idx_messaging_devices_user_id ON messaging_devices(user_id);

CREATE TABLE conversations (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_conversation_members_user_id ON conversation_members(user_id);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_user_id TEXT NOT NULL REFERENCES users(id),
    sender_device_id TEXT NOT NULL REFERENCES messaging_devices(id),
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at, id);

CREATE TABLE message_envelopes (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES messaging_devices(id) ON DELETE CASCADE,
    ephemeral_public_key TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    nonce TEXT NOT NULL,
    PRIMARY KEY (message_id, device_id)
);
CREATE INDEX idx_message_envelopes_device ON message_envelopes(device_id, message_id);
