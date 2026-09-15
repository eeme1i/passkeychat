# Useful frontend

SvelteKit client for Useful. It provides invite redemption, passkey login and
management, direct conversations, and browser-side end-to-end encryption.

See the [project README](../README.md) for the complete local setup.

## Local development

Requirements: Node.js, pnpm, a modern browser, and the backend Worker.

```sh
pnpm install
cp .env.example .env
pnpm dev
```

The frontend runs at `http://localhost:5173`; start the backend at
`http://localhost:8787` in another terminal.

## Configuration

```env
API_PROXY_TARGET=http://localhost:8787
```

`API_PROXY_TARGET` controls Vite's development proxy for `/api` and defaults to
the value above. Creating `.env` is optional for the standard setup. This
setting is not embedded in production output: production hosting must route
same-origin `/api` requests to the Worker.

## Encryption model

Each browser creates an ECDH P-256 device key. Its private key is made
non-extractable and stored in IndexedDB; only its public key is registered.

Every message gets a fresh AES-256-GCM key. That key is wrapped for each sender
and recipient device using ephemeral ECDH, HKDF-SHA-256, and AES-GCM. Plaintext
and private keys do not leave the browser.

A recipient must open the app once before receiving messages. Devices added
later cannot decrypt older messages. The current protocol has no forward
secrecy, safety-number verification, or protection against a malicious server
replacing public keys or frontend code.

## Commands

```sh
pnpm dev          # start Vite
pnpm check        # Svelte and TypeScript checks
pnpm test         # unit tests
pnpm lint         # formatting and ESLint checks
pnpm format       # format the project
pnpm build        # create a production build
pnpm preview      # preview the build locally
```

## Deployment

The project currently uses SvelteKit's automatic adapter. Select and configure
the adapter for the production host. Serve the frontend and `/api` from the
same site: the API uses strict cookies and exact-origin checks, while WebAuthn
credentials are scoped to the configured relying-party domain. HTTPS is
required in production.
