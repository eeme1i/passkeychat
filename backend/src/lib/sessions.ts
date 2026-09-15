import type { Context } from 'hono';
import {
  deleteCookie,
  getCookie,
  setCookie,
} from 'hono/cookie';

import type { AppEnv } from '../env';
import {
  randomToken,
  sha256,
} from './encoding';

const SESSION_COOKIE = 'session';

const SESSION_DURATION_MS =
  30 * 24 * 60 * 60 * 1000;

export async function createSession(
  c: Context<AppEnv>,
  userId: string,
): Promise<void> {
  const token = randomToken();
  const tokenHash = await sha256(token);

  const now = Date.now();
  const expiresAt = now + SESSION_DURATION_MS;

  await c.env.DB.batch([
    c.env.DB.prepare(`
      DELETE FROM sessions
      WHERE expires_at <= ?
    `).bind(now),
    c.env.DB.prepare(`
      INSERT INTO sessions (
        token_hash,
        user_id,
        expires_at,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `).bind(
      tokenHash,
      userId,
      expiresAt,
      now,
    ),
  ]);

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  });
}

export async function getSessionUser(
  c: Context<AppEnv>,
): Promise<{ id: string } | null> {
  const token = getCookie(c, SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const tokenHash = await sha256(token);

  const session = await c.env.DB
    .prepare(`
      SELECT user_id
      FROM sessions
      WHERE token_hash = ?
        AND expires_at > ?
    `)
    .bind(tokenHash, Date.now())
    .first<{ user_id: string }>();

  if (!session) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return null;
  }

  return {
    id: session.user_id,
  };
}

export async function destroySession(
  c: Context<AppEnv>,
): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);

  if (token) {
    const tokenHash = await sha256(token);

    await c.env.DB
      .prepare(`
        DELETE FROM sessions
        WHERE token_hash = ?
      `)
      .bind(tokenHash)
      .run();
  }

  deleteCookie(c, SESSION_COOKIE, {
    path: '/',
  });
}
