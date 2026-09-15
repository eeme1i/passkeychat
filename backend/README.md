# Useful backend

A small Cloudflare Worker API for an invite-only private site. Authentication is
username-less and passwordless: users redeem a one-time invite to create a
discoverable WebAuthn passkey, then receive an opaque, server-side session.

## Local setup

Requirements: Node.js, pnpm, and a browser with WebAuthn support.

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

Create a seven-day local invite with `pnpm invite -- --local`. The command
prints the raw invite once; only its SHA-256 digest is stored. Pass a lifetime
of 1–90 days as the final argument, for example `pnpm invite -- --local 2`.

Run all checks with `pnpm check`.

## Configuration

- `APP_ORIGIN`: exact frontend origin, such as `http://localhost:5173` or
  `https://private.example.com`.
- `RP_ID`: WebAuthn relying-party domain without a scheme or port. Use
  `localhost` locally.
- `RP_NAME`: human-readable name shown in the passkey prompt.
- `DB`: Cloudflare D1 binding configured in `wrangler.jsonc`.

Replace the placeholder `database_id` in `wrangler.jsonc` after creating the
D1 database. Keep `.dev.vars` local; set production variables through your
Cloudflare deployment environment.

## API

All request bodies are JSON and limited to 64 KiB.

- `POST /api/auth/register/options` — `{ "inviteToken": "..." }`
- `POST /api/auth/register/verify` — `{ "flowId": "...", "response": ... }`
- `POST /api/auth/login/options`
- `POST /api/auth/login/verify` — `{ "flowId": "...", "response": ... }`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/chat/conversations` — authenticated placeholder
- `POST /api/chat/completions` — validated, authenticated placeholder
- `GET /health` — process liveness
- `GET /ready` — D1 readiness

Challenges live for five minutes and are atomically consumed before WebAuthn
verification. Sessions live for 30 days, are stored only as SHA-256 digests,
and use `HttpOnly`, `SameSite=Strict` cookies (`Secure` on HTTPS).

## Deploy

```sh
pnpm db:migrate:remote
pnpm check
pnpm deploy
pnpm invite -- --remote
```

Before public exposure, enable Cloudflare rate limiting for the authentication
option and verification endpoints. Keeping it at the edge prevents invalid
requests from consuming Worker or D1 capacity.
