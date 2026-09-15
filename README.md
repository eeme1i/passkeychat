# Useful

Useful is a small, invite-only messaging application with passwordless passkey
authentication and browser-side end-to-end encryption.

The repository contains two independent pnpm projects:

- [`frontend/`](frontend/): SvelteKit, Svelte 5, Tailwind CSS, and Web Crypto.
- [`backend/`](backend/): Cloudflare Worker, Hono, D1, and WebAuthn.

## Features

- Invitation-only registration
- Username-less WebAuthn authentication
- Multiple named passkeys per account
- Opaque server-side sessions
- Direct conversations addressed by opaque user ID
- Per-device end-to-end message encryption
- Encrypted multi-device delivery

## Local development

Requirements: Node.js, pnpm, and a browser with passkey support.

Start the backend:

```sh
cd backend
pnpm install
pnpm db:migrate:local
pnpm dev
```

Before starting it, create `backend/.dev.vars` containing:

```env
RP_NAME=Useful
RP_ID=localhost
APP_ORIGIN=http://localhost:5173
```

In a second terminal, start the frontend:

```sh
cd frontend
pnpm install
pnpm dev
```

The frontend defaults to `http://localhost:5173` and proxies `/api` to
`http://localhost:8787`. Create a local invite in a third terminal:

```sh
cd backend
pnpm invite -- --local
```

Open the frontend and redeem the printed token. To start a conversation, share
and paste the opaque user ID under Account & passkeys. Both users must open the
messaging interface once to register a device encryption key.

## Architecture

```text
Browser
  ├─ SvelteKit UI
  ├─ WebAuthn passkeys
  └─ Web Crypto + non-extractable IndexedDB device key
          │ same-origin /api
          ▼
Cloudflare Worker (Hono)
  ├─ authentication and session validation
  ├─ conversation membership enforcement
  └─ ciphertext and key-envelope transport
          │
          ▼
Cloudflare D1
```

The backend stores account, passkey, session, device, conversation, and message
metadata. Message plaintext and private encryption keys remain in the browser.

## Checks

Run checks separately; the repository is not a root pnpm workspace:

```sh
cd backend && pnpm check
cd frontend && pnpm check && pnpm test
```

## Production deployment

1. Create a D1 database and update `backend/wrangler.jsonc` with its ID.
2. Configure `APP_ORIGIN`, `RP_ID`, and `RP_NAME` for the production domain.
3. Run `pnpm db:migrate:remote` from `backend/`.
4. Check and deploy the Worker with `pnpm check && pnpm deploy`.
5. Select a production SvelteKit adapter and deploy the frontend.
6. Route same-origin `/api` requests to the Worker at the hosting layer.
7. Create the first invite with `pnpm invite -- --remote`.

Use HTTPS. The frontend origin, Worker origin checks, cookies, and WebAuthn RP
ID must agree. Add edge rate limits to authentication endpoints.

## Security scope

Messages use AES-256-GCM with fresh keys wrapped for registered devices using
ephemeral ECDH P-256, HKDF-SHA-256, and AES-GCM. This protects contents from a
database leak or passive backend access.

The design does not provide forward secrecy, independent device verification,
safety numbers, metadata privacy, or protection against a malicious server
serving altered code or substituting public keys. It should not be positioned
as a high-risk or Signal-equivalent messenger.
