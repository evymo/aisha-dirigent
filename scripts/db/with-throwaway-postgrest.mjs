#!/usr/bin/env node
/**
 * with-throwaway-postgrest.mjs — attach a REAL PostgREST in front of the
 * throwaway DB, so the svc-ai-chat reflection orchestrator can be exercised
 * end-to-end against a real database over its real HTTP surface (not mocks).
 *
 * MUST run INSIDE with-throwaway-db.mjs, which exports AISHA_DB_URL for a fresh
 * baselined + seeded pg17 (container name `aisha-testdb-throwaway`, bound to
 * 127.0.0.1). Because that bind is loopback-only, PostgREST cannot reach it via
 * host.docker.internal — instead we attach the DB container to a user-defined
 * docker network and let PostgREST dial it by container name.
 *
 * This harness: starts a postgrest container on that network, mints a
 * service_role JWT (HS256, the cold-start `role` claim recipe), exports
 * POSTGREST_URL + POSTGREST_SERVICE_TOKEN, runs the wrapped command, tears down.
 *
 * Usage (composed):
 *   node scripts/db/with-throwaway-db.mjs -- \
 *     node scripts/db/with-throwaway-postgrest.mjs -- <command...>
 *
 * @module
 */
import { execFileSync, spawnSync } from 'child_process';
import { createHmac } from 'crypto';
import { createServer } from 'net';
import { resolveReachable } from '../lib/reachable-endpoint.mjs';

const PGRST_IMAGE = process.env.AISHA_PGRST_IMAGE || 'postgrest/postgrest:v12.2.3';
// Jméno DB kontejneru PŘICHÁZÍ od with-throwaway-db.mjs (AISHA_TESTDB_CONTAINER).
// Dokud tu bylo natvrdo, drželo to jen proto, že obě strany volily týž řetězec —
// a padlo to ve chvíli, kdy jméno muselo být per-běh unikátní (běh 514: tři DB
// lane na jednom runneru se praly o jeden kontejner). Fallback je původní
// hodnota, aby skript šel spustit i samostatně.
const DB_CONTAINER = process.env.AISHA_TESTDB_CONTAINER || 'aisha-testdb-throwaway';
// Odvozené od DB kontejneru, takže je unikátní ze stejného důvodu a je z názvu
// vidět, ke které databázi patří.
const PGRST_CONTAINER = `${DB_CONTAINER}-postgrest`;
const NETWORK = `${DB_CONTAINER}-net`;
// HS256 secret for the throwaway only (>=32 bytes). Never a real credential.
const JWT_SECRET = 'aisha-throwaway-postgrest-jwt-secret-0123456789-abcdefghij';

const dashIdx = process.argv.indexOf('--');
const command = dashIdx >= 0 ? process.argv.slice(dashIdx + 1) : [];
if (command.length === 0) {
  console.error('Usage: node scripts/db/with-throwaway-postgrest.mjs -- <command> [args...]');
  process.exit(2);
}
if (!process.env.AISHA_DB_URL) {
  console.error('❌ AISHA_DB_URL not set — run inside with-throwaway-db.mjs');
  process.exit(1);
}

const b64u = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function mintServiceJwt() {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ role: 'service_role', iss: 'aisha', iat: now, exp: now + 3600 }));
  const sig = b64u(createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}
function pickPort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(0));
    s.once('listening', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.listen(0, '127.0.0.1');
  });
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  spawnSync('docker', ['rm', '-f', PGRST_CONTAINER], { stdio: 'ignore' });
  spawnSync('docker', ['network', 'disconnect', '-f', NETWORK, DB_CONTAINER], { stdio: 'ignore' });
  spawnSync('docker', ['network', 'rm', NETWORK], { stdio: 'ignore' });
}

async function main() {
  spawnSync('docker', ['rm', '-f', PGRST_CONTAINER], { stdio: 'ignore' });
  // User-defined network so PostgREST can dial the loopback-bound DB by name.
  spawnSync('docker', ['network', 'create', NETWORK], { stdio: 'ignore' });
  spawnSync('docker', ['network', 'connect', NETWORK, DB_CONTAINER], { stdio: 'ignore' });

  const pgrstPort = await pickPort();
  const token = mintServiceJwt();
  // PostgREST connects as the superuser postgres (known throwaway pw) and SET
  // ROLEs to service_role/anon per the JWT claim — fine for a disposable test DB.
  const dbUri = `postgresql://postgres:postgres@${DB_CONTAINER}:5432/postgres`;

  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  let exitCode = 0;
  try {
    console.log(`🚀 PostgREST '${PGRST_CONTAINER}' on 127.0.0.1:${pgrstPort} → ${DB_CONTAINER}:5432 …`);
    execFileSync('docker', [
      'run', '-d', '--name', PGRST_CONTAINER, '--network', NETWORK,
      '-p', `127.0.0.1:${pgrstPort}:3000`,
      '-e', `PGRST_DB_URI=${dbUri}`,
      '-e', `PGRST_JWT_SECRET=${JWT_SECRET}`,
      '-e', 'PGRST_DB_SCHEMAS=public',
      '-e', 'PGRST_DB_ANON_ROLE=anon',
      '-e', 'PGRST_DB_POOL=4',
      '-e', 'PGRST_LOG_LEVEL=error',
      PGRST_IMAGE,
    ], { stdio: 'inherit' });

    // PGRST runs on NETWORK so it can reach the DB by container name (DNS), but the job
    // (a dind container on a per-job network) is on neither NETWORK nor the default
    // bridge. resolveReachable() attaches PGRST to the job's own network(s) so the job
    // can reach it by IP, then resolves a job-reachable endpoint on its in-container
    // port 3000 (the published 127.0.0.1:port lands on the dind loopback, unreachable).
    const ep = await resolveReachable({ container: PGRST_CONTAINER, inPort: 3000, host: '127.0.0.1', port: pgrstPort, timeoutMs: 30_000 });
    if (!ep) {
      console.error(`❌ PostgREST unreachable on 127.0.0.1:${pgrstPort} AND its container IP:3000. Recent logs:`);
      console.error(spawnSync('docker', ['logs', '--tail', '40', PGRST_CONTAINER], { encoding: 'utf-8' }).stderr);
      process.exit(1);
    }
    const url = `http://${ep.host}:${ep.port}`;
    if (ep.via !== 'published') console.log(`ℹ️  PostgREST reachable via ${ep.via} at ${url} (DinD published port not bridged to the job)`);

    console.log('⏳ Waiting for PostgREST to accept requests…');
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      const r = spawnSync('curl', ['-fsS', '-o', '/dev/null', url], { encoding: 'utf-8' });
      if (r.status === 0) { ready = true; break; }
      spawnSync('sleep', ['1']);
    }
    if (!ready) {
      console.error('❌ PostgREST not ready within 60s. Recent logs:');
      console.error(spawnSync('docker', ['logs', '--tail', '40', PGRST_CONTAINER], { encoding: 'utf-8' }).stderr);
      process.exit(1);
    }

    // Also expose the throwaway HS256 secret so integration tests can mint a USER token
    // (role=authenticated, sub=<uuid>) — not just the service token. Disposable test secret only.
    // AISHA_TEST_LANE=integration DEKLARUJE lane: vitest konfigurace služeb pak adresu
    // nepřebijí literálem `.invalid` (scripts/test/postgrest-vstup-testu.mjs — test.env
    // přiřazuje bezpodmínečně, naměřeno 2026-09-13 na test:integration:rag-eval).
    const runEnv = {
      ...process.env,
      AISHA_TEST_LANE: 'integration',
      POSTGREST_URL: url,
      POSTGREST_SERVICE_TOKEN: token,
      POSTGREST_JWT_SECRET: JWT_SECRET,
    };
    console.log(`\n🧪 POSTGREST_URL=${url} — running: ${command.join(' ')}\n`);
    try {
      execFileSync(command[0], command.slice(1), { stdio: 'inherit', env: runEnv });
    } catch (err) {
      exitCode = typeof err?.status === 'number' ? err.status : 1;
    }
  } finally {
    cleanup();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  cleanup();
  console.error(`❌ with-throwaway-postgrest failed: ${err.message}`);
  process.exit(1);
});
