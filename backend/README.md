# Useful backend

Cloudflare Worker API for Useful, an invite-only, passwordless messaging app.
It uses Hono, Cloudflare D1, WebAuthn passkeys, opaque server-side sessions, and
stores only end-to-end encrypted message payloads.

See the [project README](../README.md) for the complete local setup.

## Local development

Requirements: Node.js, pnpm, and a browser with WebAuthn support.

```sh
pnpm install
pnpm db:migrate:local
pnpm dev
```

Create an ignored `.dev.vars` file before starting the Worker:

```env
RP_NAME=Useful
RP_ID=localhost
APP_ORIGIN=http://localhost:5173
```

These development defaults expect the frontend at `http://localhost:5173`.
Create a seven-day local invitation with:

```sh
pnpm invite -- --local
```

An optional final argument sets its lifetime from 1–90 days, for example
`pnpm invite -- --local 2`. The raw token is shown once; D1 stores its SHA-256
digest.

## Configuration

- `APP_ORIGIN`: Exact frontend origin, including scheme and any port.
- `RP_ID`: WebAuthn relying-party domain without scheme or port. Use
  `localhost` locally.
- `RP_NAME`: Human-readable application name in passkey prompts.
- `DB`: D1 binding declared in `wrangler.jsonc`.

Create a production D1 database and replace the placeholder `database_id` in
`wrangler.jsonc` before deploying. Configure production variables through
Cloudflare rather than committing them. `APP_ORIGIN` must match the origin
received by the Worker; it validates WebAuthn ceremonies and mutations.

## Database

Migrations create invitations, users, passkeys, challenges, sessions, messaging
devices, conversations, encrypted messages, and per-device key envelopes.

```sh
pnpm db:migrate:local
pnpm db:migrate:remote
pnpm db:cleanup:local
pnpm db:cleanup:remote
```

Cleanup removes expired sessions and challenges, plus consumed or expired
invites that are no longer referenced.

## API overview

Authentication:

- `POST /api/auth/register/options`
- `POST /api/auth/register/verify`
- `POST /api/auth/login/options`
- `POST /api/auth/login/verify`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET|POST|PATCH|DELETE /api/auth/passkeys/...`

Encrypted messaging:

- `PUT /api/chat/devices/:deviceId`
- `GET /api/chat/users/:userId/devices`
- `GET|POST /api/chat/conversations`
- `GET|POST /api/chat/conversations/:conversationId/messages`

Status endpoints are `GET /health` and `GET /ready`. Mutation bodies are JSON,
`/api` requests are limited to 64 KiB, and chat routes require a session.

## Security

Registration requires a one-time invitation. Authentication uses discoverable
WebAuthn credentials, so no username or password is collected. Challenges live
for five minutes and are atomically consumed. Sessions live for 30 days, are
stored as SHA-256 digests, and use `HttpOnly`, `SameSite=Strict` cookies with
`Secure` enabled over HTTPS.

The backend receives ciphertext, nonces, public device keys, and encrypted key
envelopes—not message plaintext. Conversation members, device IDs, timestamps,
and traffic patterns remain visible metadata.

## Checks and deployment

```sh
pnpm check
pnpm db:migrate:remote
pnpm deploy
pnpm invite -- --remote
```

Run migrations before deploying dependent code. Add Cloudflare rate limiting to
authentication option and verification routes before public exposure.
