import { Hono } from 'hono';
import { z } from 'zod';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';

import {
  isoUint8Array,
} from '@simplewebauthn/server/helpers';

import type { AppEnv } from '../env';
import { parseJson } from '../lib/http';
import { requireSession } from '../middleware/session';

import {
  base64urlToBytes,
  bytesToBase64url,
  randomToken,
  sha256,
} from '../lib/encoding';

import {
  createSession,
  destroySession,
  getSessionUser,
} from '../lib/sessions';

const auth = new Hono<AppEnv>();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const flowIdSchema = z.string().min(32).max(128);
const credentialBaseSchema = z.object({
  id: z.string().min(1).max(2048),
  rawId: z.string().min(1).max(2048),
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
});

const registrationResponseSchema = credentialBaseSchema.extend({
  response: z.object({
    clientDataJSON: z.string().min(1).max(16_384),
    attestationObject: z.string().min(1).max(49_152),
    transports: z.array(z.string()).max(16).optional(),
    authenticatorData: z.string().optional(),
    publicKey: z.string().optional(),
    publicKeyAlgorithm: z.number().int().optional(),
  }).passthrough(),
}).passthrough();

const authenticationResponseSchema = credentialBaseSchema.extend({
  response: z.object({
    clientDataJSON: z.string().min(1).max(16_384),
    authenticatorData: z.string().min(1).max(16_384),
    signature: z.string().min(1).max(16_384),
    userHandle: z.string().nullable().optional(),
  }).passthrough(),
}).passthrough();

const registerOptionsSchema = z.object({
  inviteToken: z.string().min(32).max(1024),
}).strict();

const registerVerifySchema = z.object({
  flowId: flowIdSchema,
  response: registrationResponseSchema,
}).strict();

const loginVerifySchema = z.object({
  flowId: flowIdSchema,
  response: authenticationResponseSchema,
}).strict();

const passkeyVerifySchema = registerVerifySchema.extend({
  name: z.string().trim().min(1).max(80).optional(),
}).strict();

const passkeyNameSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict();

type ChallengeRow = {
  id: string;
  challenge: string;
  user_id: string | null;
  invite_id: string | null;
  expires_at: number;
};

type PasskeyRow = {
  credential_id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
};

auth.use('/passkeys', requireSession);
auth.use('/passkeys/*', requireSession);

auth.get('/passkeys', async (c) => {
  const user = c.get('user');
  const result = await c.env.DB.prepare(`
    SELECT credential_id, name, device_type, backed_up, created_at, last_used_at
    FROM passkeys
    WHERE user_id = ?
    ORDER BY created_at ASC
  `).bind(user.id).all();

  return c.json({ passkeys: result.results });
});

auth.post('/passkeys/options', async (c) => {
  const user = c.get('user');
  const existing = await c.env.DB.prepare(`
    SELECT credential_id, transports
    FROM passkeys
    WHERE user_id = ?
  `).bind(user.id).all<{ credential_id: string; transports: string | null }>();

  const options = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID: c.env.RP_ID,
    userID: isoUint8Array.fromUTF8String(user.id),
    userName: `user-${user.id}`,
    attestationType: 'none',
    excludeCredentials: existing.results.map((passkey) => ({
      id: passkey.credential_id,
      transports: passkey.transports ? JSON.parse(passkey.transports) : [],
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });

  const now = Date.now();
  const flowId = randomToken();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ?').bind(now),
    c.env.DB.prepare(`
      INSERT INTO webauthn_challenges
        (id, kind, challenge, user_id, expires_at, created_at)
      VALUES (?, 'passkey_registration', ?, ?, ?, ?)
    `).bind(flowId, options.challenge, user.id, now + CHALLENGE_TTL_MS, now),
  ]);

  return c.json({ flowId, options });
});

auth.post('/passkeys/verify', async (c) => {
  const body = await parseJson(c, passkeyVerifySchema);
  if (!body) return c.json({ error: 'invalid_request' }, 400);

  const user = c.get('user');
  const flow = await c.env.DB.prepare(`
    SELECT id, challenge, user_id, invite_id, expires_at
    FROM webauthn_challenges
    WHERE id = ? AND kind = 'passkey_registration' AND user_id = ?
  `).bind(body.flowId, user.id).first<ChallengeRow>();

  if (!flow || flow.expires_at <= Date.now()) {
    return c.json({ error: 'registration_expired' }, 400);
  }

  const consumed = await c.env.DB.prepare(`
    DELETE FROM webauthn_challenges
    WHERE id = ? AND kind = 'passkey_registration' AND user_id = ? AND expires_at > ?
  `).bind(flow.id, user.id, Date.now()).run();
  if (consumed.meta.changes !== 1) {
    return c.json({ error: 'registration_expired' }, 400);
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge: flow.challenge,
      expectedOrigin: c.env.APP_ORIGIN,
      expectedRPID: c.env.RP_ID,
      requireUserVerification: true,
    });
  } catch {
    return c.json({ error: 'registration_verification_failed' }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: 'registration_verification_failed' }, 400);
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const now = Date.now();
  try {
    await c.env.DB.prepare(`
      INSERT INTO passkeys
        (credential_id, user_id, public_key, counter, transports, device_type,
         backed_up, name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      credential.id, user.id, bytesToBase64url(credential.publicKey), credential.counter,
      JSON.stringify(credential.transports ?? []), credentialDeviceType,
      credentialBackedUp ? 1 : 0, body.name ?? 'Passkey', now,
    ).run();
  } catch {
    return c.json({ error: 'passkey_conflict' }, 409);
  }

  return c.json({ verified: true });
});

auth.patch('/passkeys/:credentialId', async (c) => {
  const body = await parseJson(c, passkeyNameSchema);
  if (!body) return c.json({ error: 'invalid_request' }, 400);
  const result = await c.env.DB.prepare(`
    UPDATE passkeys SET name = ? WHERE credential_id = ? AND user_id = ?
  `).bind(body.name, c.req.param('credentialId'), c.get('user').id).run();
  if (result.meta.changes !== 1) return c.json({ error: 'passkey_not_found' }, 404);
  return c.json({ ok: true });
});

auth.delete('/passkeys/:credentialId', async (c) => {
  const user = c.get('user');
  const result = await c.env.DB.prepare(`
    DELETE FROM passkeys
    WHERE credential_id = ? AND user_id = ?
      AND (SELECT COUNT(*) FROM passkeys WHERE user_id = ?) > 1
  `).bind(c.req.param('credentialId'), user.id, user.id).run();
  if (result.meta.changes === 1) return c.json({ ok: true });

  const exists = await c.env.DB.prepare(`
    SELECT 1 FROM passkeys WHERE credential_id = ? AND user_id = ?
  `).bind(c.req.param('credentialId'), user.id).first();
  return exists
    ? c.json({ error: 'last_passkey' }, 409)
    : c.json({ error: 'passkey_not_found' }, 404);
});

auth.post('/register/options', async (c) => {
  const body = await parseJson(c, registerOptionsSchema);

  if (!body) {
    return c.json(
      { error: 'invite_required' },
      400,
    );
  }

  const tokenHash = await sha256(body.inviteToken);
  const now = Date.now();

  const invite = await c.env.DB
    .prepare(`
      SELECT id
      FROM invites
      WHERE token_hash = ?
        AND used_at IS NULL
        AND expires_at > ?
    `)
    .bind(tokenHash, now)
    .first<{ id: string }>();

  if (!invite) {
    return c.json(
      { error: 'invalid_invite' },
      403,
    );
  }

  /*
   * This ID becomes the account ID if registration succeeds.
   * It contains no email address or other identifying data.
   */
  const userId = crypto.randomUUID();

  const options =
    await generateRegistrationOptions({
      rpName: c.env.RP_NAME,
      rpID: c.env.RP_ID,

      userID:
        isoUint8Array.fromUTF8String(userId),

      /*
       * WebAuthn requires a user name even if your application
       * has no concept of usernames.
       *
       * Keep it opaque.
       */
      userName: `user-${userId}`,

      attestationType: 'none',

      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });

  const flowId = randomToken();
  const expiresAt =
    now + CHALLENGE_TTL_MS;

  await c.env.DB.batch([
    c.env.DB.prepare(`
      DELETE FROM webauthn_challenges
      WHERE expires_at <= ?
    `).bind(now),
    c.env.DB.prepare(`
      INSERT INTO webauthn_challenges (
        id,
        kind,
        challenge,
        user_id,
        invite_id,
        expires_at,
        created_at
      )
      VALUES (?, 'registration', ?, ?, ?, ?, ?)
    `).bind(
      flowId,
      options.challenge,
      userId,
      invite.id,
      expiresAt,
      now,
    ),
  ]);

  return c.json({
    flowId,
    options,
  });
});

auth.post('/register/verify', async (c) => {
  const body = await parseJson(c, registerVerifySchema);

  if (!body) {
    return c.json(
      { error: 'invalid_request' },
      400,
    );
  }

  const flow = await c.env.DB
    .prepare(`
      SELECT
        id,
        challenge,
        user_id,
        invite_id,
        expires_at
      FROM webauthn_challenges
      WHERE id = ?
        AND kind = 'registration'
    `)
    .bind(body.flowId)
    .first<ChallengeRow>();

  if (
    !flow ||
    !flow.user_id ||
    !flow.invite_id ||
    flow.expires_at <= Date.now()
  ) {
    return c.json(
      { error: 'registration_expired' },
      400,
    );
  }

  /*
   * Consume the challenge now.
   *
   * If verification fails, the client simply starts another
   * registration ceremony.
   */
  const consumed = await c.env.DB
    .prepare(`
      DELETE FROM webauthn_challenges
      WHERE id = ?
        AND kind = 'registration'
        AND expires_at > ?
    `)
    .bind(flow.id, Date.now())
    .run();

  if (consumed.meta.changes !== 1) {
    return c.json({ error: 'registration_expired' }, 400);
  }

  let verification;

  try {
    verification =
      await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        expectedChallenge: flow.challenge,
        expectedOrigin: c.env.APP_ORIGIN,
        expectedRPID: c.env.RP_ID,
        requireUserVerification: true,
      });
  } catch {
    return c.json(
      { error: 'registration_verification_failed' },
      400,
    );
  }

  if (
    !verification.verified ||
    !verification.registrationInfo
  ) {
    return c.json(
      { error: 'registration_verification_failed' },
      400,
    );
  }

  const {
    credential,
    credentialDeviceType,
    credentialBackedUp,
  } = verification.registrationInfo;

  const now = Date.now();

  /*
   * users.invite_id is UNIQUE.
   *
   * That constraint prevents two simultaneous registration
   * ceremonies from creating two accounts with one invite.
   */
  try {
    await c.env.DB.batch([
      c.env.DB
        .prepare(`
          INSERT INTO users (
            id,
            invite_id,
            created_at
          )
          SELECT ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM invites
            WHERE id = ?
              AND used_at IS NULL
              AND expires_at > ?
          )
        `)
        .bind(
          flow.user_id,
          flow.invite_id,
          now,
          flow.invite_id,
          now,
        ),

      c.env.DB
        .prepare(`
          INSERT INTO passkeys (
            credential_id,
            user_id,
            public_key,
            counter,
            transports,
            device_type,
            backed_up,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          credential.id,
          flow.user_id,
          bytesToBase64url(credential.publicKey),
          credential.counter,
          JSON.stringify(
            credential.transports ?? [],
          ),
          credentialDeviceType,
          credentialBackedUp ? 1 : 0,
          now,
        ),

      c.env.DB
        .prepare(`
          UPDATE invites
          SET used_at = ?
          WHERE id = ?
            AND used_at IS NULL
        `)
        .bind(
          now,
          flow.invite_id,
        ),
    ]);
  } catch {
    return c.json(
      { error: 'registration_conflict' },
      409,
    );
  }

  await createSession(
    c,
    flow.user_id,
  );

  return c.json({
    verified: true,
    user: {
      id: flow.user_id,
    },
  });
});

auth.post('/login/options', async (c) => {
  const options =
    await generateAuthenticationOptions({
      rpID: c.env.RP_ID,

      /*
       * Deliberately omit allowCredentials.
       *
       * This lets the authenticator discover the account from
       * the passkey instead of asking for a username first.
       */
      userVerification: 'required',
    });

  const now = Date.now();
  const flowId = randomToken();

  await c.env.DB.batch([
    c.env.DB.prepare(`
      DELETE FROM webauthn_challenges
      WHERE expires_at <= ?
    `).bind(now),
    c.env.DB.prepare(`
      INSERT INTO webauthn_challenges (
        id,
        kind,
        challenge,
        expires_at,
        created_at
      )
      VALUES (?, 'authentication', ?, ?, ?)
    `).bind(
      flowId,
      options.challenge,
      now + CHALLENGE_TTL_MS,
      now,
    ),
  ]);

  return c.json({
    flowId,
    options,
  });
});

auth.post('/login/verify', async (c) => {
  const body = await parseJson(c, loginVerifySchema);

  if (!body) {
    return c.json(
      { error: 'invalid_request' },
      400,
    );
  }

  const flow = await c.env.DB
    .prepare(`
      SELECT
        id,
        challenge,
        user_id,
        invite_id,
        expires_at
      FROM webauthn_challenges
      WHERE id = ?
        AND kind = 'authentication'
    `)
    .bind(body.flowId)
    .first<ChallengeRow>();

  if (!flow || flow.expires_at <= Date.now()) {
    return c.json(
      { error: 'authentication_expired' },
      400,
    );
  }

  const consumed = await c.env.DB
    .prepare(`
      DELETE FROM webauthn_challenges
      WHERE id = ?
        AND kind = 'authentication'
        AND expires_at > ?
    `)
    .bind(flow.id, Date.now())
    .run();

  if (consumed.meta.changes !== 1) {
    return c.json({ error: 'authentication_expired' }, 400);
  }

  /*
   * response.id identifies the credential.
   *
   * This is what gives us passwordless AND username-less login.
   */
  const passkey = await c.env.DB
    .prepare(`
      SELECT
        credential_id,
        user_id,
        public_key,
        counter,
        transports
      FROM passkeys
      WHERE credential_id = ?
    `)
    .bind(body.response.id)
    .first<PasskeyRow>();

  if (!passkey) {
    return c.json(
      { error: 'unknown_passkey' },
      401,
    );
  }

  const credential: WebAuthnCredential = {
    id: passkey.credential_id,
    publicKey:
      base64urlToBytes(passkey.public_key),
    counter: passkey.counter,
    transports: passkey.transports
      ? JSON.parse(passkey.transports)
      : [],
  };

  let verification;

  try {
    verification =
      await verifyAuthenticationResponse({
        response: body.response as AuthenticationResponseJSON,
        expectedChallenge: flow.challenge,
        expectedOrigin: c.env.APP_ORIGIN,
        expectedRPID: c.env.RP_ID,
        credential,
        requireUserVerification: true,
      });
  } catch {
    return c.json(
      { error: 'authentication_failed' },
      401,
    );
  }

  if (!verification.verified) {
    return c.json(
      { error: 'authentication_failed' },
      401,
    );
  }

  const now = Date.now();

  await c.env.DB
    .prepare(`
      UPDATE passkeys
      SET
        counter = MAX(counter, ?),
        last_used_at = ?
      WHERE credential_id = ?
    `)
    .bind(
      verification.authenticationInfo.newCounter,
      now,
      passkey.credential_id,
    )
    .run();

  await createSession(
    c,
    passkey.user_id,
  );

  return c.json({
    verified: true,
    user: {
      id: passkey.user_id,
    },
  });
});

auth.get('/me', async (c) => {
  const user = await getSessionUser(c);

  return c.json({
    user,
  });
});

auth.post('/logout', async (c) => {
  await destroySession(c);

  return c.json({
    ok: true,
  });
});

export default auth;
