import { spawnSync } from 'node:child_process';

const target = process.argv[2];

if (target !== '--local' && target !== '--remote') {
  console.error('Usage: node scripts/cleanup-db.mjs --local|--remote');
  process.exit(2);
}

const now = Date.now();
const sql = [
  `DELETE FROM webauthn_challenges WHERE expires_at <= ${now};`,
  `DELETE FROM sessions WHERE expires_at <= ${now};`,
  `UPDATE users SET invite_id = NULL
   WHERE invite_id IN (
     SELECT id FROM invites
     WHERE used_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM webauthn_challenges
         WHERE webauthn_challenges.invite_id = invites.id
       )
   );`,
  `DELETE FROM invites
   WHERE (used_at IS NOT NULL OR expires_at <= ${now})
     AND NOT EXISTS (
       SELECT 1 FROM webauthn_challenges
       WHERE webauthn_challenges.invite_id = invites.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM users
       WHERE users.invite_id = invites.id
     );`,
].join(' ');

const result = spawnSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'useful-database',
    target,
    '--yes',
    '--command',
    sql,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

if (result.status !== 0) {
  console.error('Database cleanup failed.');
  process.exit(result.status ?? 1);
}

console.log(`Database cleanup completed (${target.slice(2)}).`);
