import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

if (args[0] === '--') {
  args.shift();
}

const target = args[0];

if (target !== '--local' && target !== '--remote') {
  console.error('Usage: pnpm invite -- --local|--remote [days]');
  process.exit(2);
}

const days = Number(args[1] ?? 7);

if (!Number.isInteger(days) || days < 1 || days > 90) {
  console.error('Expiry must be a whole number from 1 to 90 days.');
  process.exit(2);
}

const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('base64url');
const now = Date.now();
const expiresAt = now + days * 24 * 60 * 60 * 1000;
const sql = [
  'INSERT INTO invites (id, token_hash, expires_at, created_at)',
  `VALUES ('${randomUUID()}', '${tokenHash}', ${expiresAt}, ${now});`,
].join(' ');

const result = spawnSync(
  'pnpm',
  ['exec', 'wrangler', 'd1', 'execute', 'useful-database', target, '--command', sql],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

if (result.status !== 0) {
  console.error('Invite was not created.');
  process.exit(result.status ?? 1);
}

console.log(`Invite token (shown once): ${token}`);
console.log(`Expires: ${new Date(expiresAt).toISOString()}`);
