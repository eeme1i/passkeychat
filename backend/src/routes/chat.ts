import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../env';
import { parseJson } from '../lib/http';
import { requireSession } from '../middleware/session';

const chat = new Hono<AppEnv>();
chat.use('*', requireSession);

const id = z.string().uuid();
const encoded = z.string().min(1).max(64_000).regex(/^[A-Za-z0-9_-]+$/);
const publicKey = z.object({
  kty: z.literal('EC'), crv: z.literal('P-256'),
  x: encoded.max(128), y: encoded.max(128),
  ext: z.boolean().optional(), key_ops: z.array(z.string()).optional(),
}).passthrough();
const envelopeSchema = z.object({
  deviceId: id, ephemeralPublicKey: publicKey,
  wrappedKey: encoded.max(1024), nonce: encoded.max(128),
}).strict();

chat.put('/devices/:deviceId', async (c) => {
  const deviceId = id.safeParse(c.req.param('deviceId'));
  const body = await parseJson(c, z.object({ publicKey }).strict());
  if (!deviceId.success || !body) return c.json({ error: 'invalid_request' }, 400);
  const user = c.get('user');
  const existing = await c.env.DB.prepare(
    'SELECT user_id, public_key FROM messaging_devices WHERE id = ?',
  ).bind(deviceId.data).first<{ user_id: string; public_key: string }>();
  const serialized = JSON.stringify(body.publicKey);
  if (existing && (existing.user_id !== user.id || existing.public_key !== serialized)) {
    return c.json({ error: 'device_conflict' }, 409);
  }
  const now = Date.now();
  await c.env.DB.prepare(`
    INSERT INTO messaging_devices (id, user_id, public_key, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).bind(deviceId.data, user.id, serialized, now, now).run();
  return c.json({ ok: true });
});

chat.get('/users/:userId/devices', async (c) => {
  const userId = id.safeParse(c.req.param('userId'));
  if (!userId.success) return c.json({ error: 'invalid_request' }, 400);
  if (!await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId.data).first()) {
    return c.json({ error: 'user_not_found' }, 404);
  }
  const result = await c.env.DB.prepare(`
    SELECT id, user_id, public_key, created_at FROM messaging_devices
    WHERE user_id = ? ORDER BY created_at
  `).bind(userId.data).all();
  return c.json({ devices: result.results.map((row) => ({
    id: row.id, userId: row.user_id, publicKey: JSON.parse(String(row.public_key)),
    createdAt: row.created_at,
  })) });
});

chat.get('/conversations', async (c) => {
  const user = c.get('user');
  const result = await c.env.DB.prepare(`
    SELECT c.id, c.created_at,
      (SELECT cm2.user_id FROM conversation_members cm2
       WHERE cm2.conversation_id = c.id AND cm2.user_id != ? LIMIT 1) peer_id,
      (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) last_message_at
    FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ? ORDER BY COALESCE(last_message_at, c.created_at) DESC
  `).bind(user.id, user.id).all();
  return c.json({ conversations: result.results.map((row) => ({
    id: row.id, peerId: row.peer_id, createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
  })) });
});

chat.post('/conversations', async (c) => {
  const body = await parseJson(c, z.object({ userId: id }).strict());
  if (!body) return c.json({ error: 'invalid_request' }, 400);
  const user = c.get('user');
  if (body.userId === user.id) return c.json({ error: 'cannot_message_self' }, 400);
  if (!await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(body.userId).first()) {
    return c.json({ error: 'user_not_found' }, 404);
  }
  const existing = await c.env.DB.prepare(`
    SELECT cm.conversation_id id FROM conversation_members cm
    JOIN conversation_members peer ON peer.conversation_id = cm.conversation_id
    WHERE cm.user_id = ? AND peer.user_id = ?
      AND (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = cm.conversation_id) = 2
    LIMIT 1
  `).bind(user.id, body.userId).first<{ id: string }>();
  if (existing) return c.json({ conversation: { id: existing.id, peerId: body.userId } });
  const conversationId = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO conversations (id, created_at) VALUES (?, ?)').bind(conversationId, now),
    c.env.DB.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)').bind(conversationId, user.id, now),
    c.env.DB.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)').bind(conversationId, body.userId, now),
  ]);
  return c.json({ conversation: { id: conversationId, peerId: body.userId } }, 201);
});

function membership(c: Context<AppEnv>, conversationId: string, userId: string) {
  return c.env.DB.prepare(
    'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
  ).bind(conversationId, userId).first();
}

chat.get('/conversations/:conversationId/messages', async (c) => {
  const conversationId = id.safeParse(c.req.param('conversationId'));
  const deviceId = id.safeParse(c.req.query('deviceId'));
  if (!conversationId.success || !deviceId.success) return c.json({ error: 'invalid_request' }, 400);
  const user = c.get('user');
  if (!await membership(c, conversationId.data, user.id)) return c.json({ error: 'not_found' }, 404);
  if (!await c.env.DB.prepare('SELECT 1 FROM messaging_devices WHERE id = ? AND user_id = ?')
    .bind(deviceId.data, user.id).first()) return c.json({ error: 'device_not_found' }, 404);
  const after = Math.max(0, Number(c.req.query('after') ?? 0) || 0);
  const result = await c.env.DB.prepare(`
    SELECT m.id, m.sender_user_id, m.sender_device_id, m.ciphertext, m.nonce, m.created_at,
           e.ephemeral_public_key, e.wrapped_key, e.nonce envelope_nonce
    FROM messages m JOIN message_envelopes e ON e.message_id = m.id AND e.device_id = ?
    WHERE m.conversation_id = ? AND m.created_at > ?
    ORDER BY m.created_at, m.id LIMIT 200
  `).bind(deviceId.data, conversationId.data, after).all();
  return c.json({ messages: result.results.map((row) => ({
    id: row.id, senderUserId: row.sender_user_id, senderDeviceId: row.sender_device_id,
    ciphertext: row.ciphertext, nonce: row.nonce, createdAt: row.created_at,
    envelope: { ephemeralPublicKey: JSON.parse(String(row.ephemeral_public_key)),
      wrappedKey: row.wrapped_key, nonce: row.envelope_nonce },
  })) });
});

chat.post('/conversations/:conversationId/messages', async (c) => {
  const conversationId = id.safeParse(c.req.param('conversationId'));
  const body = await parseJson(c, z.object({
    id, senderDeviceId: id, ciphertext: encoded, nonce: encoded.max(128),
    envelopes: z.array(envelopeSchema).min(1).max(50),
  }).strict());
  if (!conversationId.success || !body) return c.json({ error: 'invalid_request' }, 400);
  const user = c.get('user');
  if (!await membership(c, conversationId.data, user.id)) return c.json({ error: 'not_found' }, 404);
  if (!await c.env.DB.prepare('SELECT 1 FROM messaging_devices WHERE id = ? AND user_id = ?')
    .bind(body.senderDeviceId, user.id).first()) return c.json({ error: 'device_not_found' }, 404);
  const uniqueIds = [...new Set(body.envelopes.map((item) => item.deviceId))];
  if (uniqueIds.length !== body.envelopes.length) return c.json({ error: 'invalid_request' }, 400);
  for (const deviceId of uniqueIds) {
    const allowed = await c.env.DB.prepare(`
      SELECT 1 FROM messaging_devices d JOIN conversation_members cm ON cm.user_id = d.user_id
      WHERE d.id = ? AND cm.conversation_id = ?
    `).bind(deviceId, conversationId.data).first();
    if (!allowed) return c.json({ error: 'invalid_recipient_device' }, 400);
  }
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO messages
        (id, conversation_id, sender_user_id, sender_device_id, ciphertext, nonce, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(body.id, conversationId.data, user.id, body.senderDeviceId, body.ciphertext, body.nonce, now),
      ...body.envelopes.map((item) => c.env.DB.prepare(`INSERT INTO message_envelopes
        (message_id, device_id, ephemeral_public_key, wrapped_key, nonce) VALUES (?, ?, ?, ?, ?)`
      ).bind(body.id, item.deviceId, JSON.stringify(item.ephemeralPublicKey), item.wrappedKey, item.nonce)),
    ]);
  } catch {
    return c.json({ error: 'message_conflict' }, 409);
  }
  return c.json({ message: { id: body.id, createdAt: now } }, 201);
});

export default chat;
