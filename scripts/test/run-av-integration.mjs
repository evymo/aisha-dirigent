#!/usr/bin/env node
/**
 * run-av-integration.mjs — the DinD-aligned runner for the upload-AV integration suite.
 *
 * Brings up REAL clamd + MinIO using `docker build` + `docker run` — the SAME primitives the
 * coldstart-db-gate CI job uses, so this runs identically on a developer machine and on the
 * self-hosted DinD CI runner (which has `docker run`, but NOT necessarily the
 * `docker compose` plugin). Waits for MinIO (HTTP health) + clamd (a real PING ⇒ PONG, which
 * only succeeds once the signature DB is loaded — a bare TCP connect is NOT enough), ensures the
 * minio client is installed for storage-auth, runs the *.it.test.ts suite (vitest.it.config.ts)
 * against the live backends, and ALWAYS tears the containers down.
 *
 * Local: `npm run test:integration:av`. CI: the av-integration-gate job invokes the same.
 *
 * clamav/clamav is published amd64-only, so the image is built/run for linux/amd64 — native on
 * amd64 (CI / prod-like), emulated on arm64 dev (Apple Silicon). The Postgres leg of the AV
 * flow is covered separately by coldstart-db-gate (src/tests/db/document-av-scan-rpc-runtime.test.ts).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';
import { resolveReachable } from '../lib/reachable-endpoint.mjs';
import { registryProxyBuildArgs } from '../lib/registry-proxy.mjs';

const CLAMD_PORT = process.env.AV_IT_CLAMD_PORT ?? '3310';
const MINIO_PORT = process.env.AV_IT_MINIO_PORT ?? '9000';
const MINIO_USER = process.env.AV_IT_MINIO_USER ?? 'minioadmin';
const MINIO_PASSWORD = process.env.AV_IT_MINIO_PASSWORD ?? 'minioadmin';
// MinIO se staví ZE ZDROJE týmž Dockerfilem jako v produkci (docker/minio, cíl
// `minio`): obrazy z registrů neexistují (Docker Hub smazán 2026-09-11, quay.io
// 401 od 2026-09-24). Test tak běží nad TÍM obrazem, který nasazení postaví —
// a CI (amd64) mimochodem ověří, že se Dockerfile na amd64 postaví a server
// odpoví na /minio/health/live. Nativní platforma: MinIO je multi-arch, jen
// clamav ne. Kontext je jen docker/minio (žádný přenos repa do DinD).
const MINIO_IMAGE = 'aisha-av-it-minio:latest';
const MINIO_DOCKERFILE = 'docker/minio/Dockerfile';
const CLAMD_IMAGE = 'aisha-av-it-clamd:latest';
const CLAMD_NAME = 'aisha-av-it-clamd';
const MINIO_NAME = 'aisha-av-it-minio';
// clamav/clamav has no arm64 manifest — pin amd64 (native on CI, emulated on Apple Silicon).
const PLATFORM = process.env.AV_IT_PLATFORM ?? 'linux/amd64';
const SERVICE_DIR = 'services/storage-auth';

const testEnv = {
  ...process.env,
  AV_IT: '1',
  CLAMD_HOST: '127.0.0.1',
  CLAMD_PORT,
  MINIO_ENDPOINT: `http://127.0.0.1:${MINIO_PORT}`,
  MINIO_ACCESS_KEY: MINIO_USER,
  MINIO_SECRET_KEY: MINIO_PASSWORD,
  MINIO_REGION: 'us-east-1',
};

const docker = (args, opts = {}) => execFileSync('docker', args, { stdio: 'inherit', ...opts });
const rm = (name) => spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });

// Output-capturing docker (for inspect/logs diagnostics — never inherits/throws).
const dockerOut = (args) => {
  try {
    return execFileSync('docker', args, { encoding: 'utf8' });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
};
// If the named container has exited, return "exited <code>" else null. `httpReady`
// counts ANY response (even a 503) as ready, so a 240s "not ready" means the backend
// is not serving at all — almost always a crashed/port-unpublished container, NOT a
// slow one. Detecting the exit lets us fail in seconds WITH the real reason instead of
// blocking 240s and hiding it (the AV lane's opaque "minio not ready after 240s").
function containerDied(name) {
  const s = dockerOut(['inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', name]).trim();
  return s.startsWith('exited') ? s : null;
}
function dumpContainer(name) {
  console.error(`\n──── ${name} diagnostics ────`);
  console.error(
    dockerOut(['inspect', '-f', 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} err={{.State.Error}}', name]).trim(),
  );
  console.error(`──── ${name} logs (tail 60) ────`);
  console.error(dockerOut(['logs', '--tail', '60', name]));
}

// clamd opens its socket BEFORE the signature DB finishes loading, so a bare TCP connect is a
// false "ready". PING is answered by clamd's command loop, which starts only once the DB is
// loaded — so PONG is the true scan-readiness signal (a bare TCP connect was the b3iauvcb4 flake).
// An EXPLICIT hard timer (cleared on settle) guarantees the promise always resolves — relying on
// socket.setTimeout's idle timer left it unsettled when clamd held the connection open silently.
function clamdPing(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    let settled = false;
    const sock = net.connect({ host, port: Number(port) });
    let buf = '';
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 3000);
    sock.on('connect', () => sock.write('zPING\0'));
    sock.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('PONG')) finish(true);
    });
    sock.on('error', () => finish(false));
    sock.on('close', () => finish(false));
  });
}

async function httpReady(url) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitFor(label, probe, tries, delayMs, containerName) {
  for (let i = 0; i < tries; i++) {
    if (await probe()) {
      console.log(`✓ ${label} ready`);
      return;
    }
    // Fail fast (with logs) if the backing container has already crashed — no point
    // polling a dead endpoint for the full ceiling.
    if (containerName) {
      const died = containerDied(containerName);
      if (died) {
        dumpContainer(containerName);
        throw new Error(`${label} container exited (${died}) before becoming ready — see diagnostics above`);
      }
    }
    if (i > 0 && i % 10 === 0) console.log(`  …still waiting for ${label} (${(i * delayMs) / 1000}s)`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (containerName) dumpContainer(containerName); // surface WHY it never became ready
  throw new Error(`${label} not ready after ${(tries * delayMs) / 1000}s`);
}

let started = false;
try {
  // Clear any stragglers from a previous interrupted run, then build + start the backends.
  rm(CLAMD_NAME);
  rm(MINIO_NAME);

  console.log('▶ building clamd image (same infra/clamav/Dockerfile as production)…');
  docker(['build', ...registryProxyBuildArgs(), '--platform', PLATFORM, '-f', 'infra/clamav/Dockerfile', '-t', CLAMD_IMAGE, '.']);
  console.log('▶ building minio image from source (same docker/minio/Dockerfile as production)…');
  docker(['build', ...registryProxyBuildArgs(), '--target', 'minio', '-f', MINIO_DOCKERFILE, '-t', MINIO_IMAGE, 'docker/minio']);

  console.log('▶ starting minio + clamd (docker run, loopback-published)…');
  docker([
    'run', '-d', '--name', MINIO_NAME,
    '-p', `127.0.0.1:${MINIO_PORT}:9000`,
    '-e', `MINIO_ROOT_USER=${MINIO_USER}`,
    '-e', `MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}`,
    MINIO_IMAGE, 'server', '/data',
  ]);
  docker([
    'run', '-d', '--name', CLAMD_NAME, '--platform', PLATFORM,
    '-p', `127.0.0.1:${CLAMD_PORT}:3310`,
    CLAMD_IMAGE,
  ]);
  started = true;

  // Resolve job-reachable endpoints. The published 127.0.0.1:port lands on the dind
  // loopback — unreachable from the job (a sibling container inside the dind) — but the
  // container's own bridge IP on its in-container port IS reachable (proven on soren).
  // Probe both and use whichever opens; locally 127.0.0.1 wins (no behaviour change).
  const minioEp = await resolveReachable({ container: MINIO_NAME, inPort: 9000, port: Number(MINIO_PORT), timeoutMs: 60_000 });
  const clamdEp = await resolveReachable({ container: CLAMD_NAME, inPort: 3310, port: Number(CLAMD_PORT), timeoutMs: 60_000 });
  if (!minioEp || !clamdEp) {
    if (!minioEp) dumpContainer(MINIO_NAME);
    if (!clamdEp) dumpContainer(CLAMD_NAME);
    throw new Error(`backend port unreachable (minio=${!!minioEp} clamd=${!!clamdEp}) on both 127.0.0.1 and the container IP`);
  }
  if (minioEp.via !== 'published' || clamdEp.via !== 'published') {
    console.log(`ℹ️  backends via container-IP (DinD published port not bridged to job): minio ${minioEp.host}:${minioEp.port}, clamd ${clamdEp.host}:${clamdEp.port}`);
  }
  // Point both the readiness probes and the test at the resolved endpoints.
  testEnv.CLAMD_HOST = clamdEp.host;
  testEnv.CLAMD_PORT = clamdEp.port;
  testEnv.MINIO_ENDPOINT = `http://${minioEp.host}:${minioEp.port}`;

  // MinIO is ~3s healthy on an idle host, but under heavy concurrent load (clamd image
  // build + a busy shared runner / pressured Docker VM) its startup is starved and has
  // been observed to exceed 120s. Give it a 240s ceiling (still bounded) so a slow-but-
  // healthy MinIO is not flagged as a failure; serialization keeps the load down too.
  await waitFor('minio', () => httpReady(`http://${minioEp.host}:${minioEp.port}/minio/health/live`), 120, 2000, MINIO_NAME);
  console.log('⏳ waiting for clamd (PING ⇒ PONG; first boot loads the signature DB)…');
  await waitFor('clamd', () => clamdPing(clamdEp.port, clamdEp.host), 300, 2000, CLAMD_NAME);

  // The integration suite imports ../minio.ts → the `minio` client. It's a DECLARED dependency
  // of storage-auth (package.json), so after a root `npm ci` it is already present — skip the
  // install entirely then (CI always takes this path; no npm invocation ⇒ no workspace warning).
  // Only when missing (partial local install) install it — WORKSPACE-NATIVELY from the repo
  // root via -w, the supported way to target a member. Running npm with cwd inside the member
  // emits `npm warn workspaces … no workspace folder present`, and "fixing" that with
  // --no-workspaces broke the @aisha/* workspace links (registry 404 incident, 2026-07-14).
  console.log('▶ ensuring the minio client is installed for storage-auth…');
  const resolvable = spawnSync(process.execPath, ['-e', "require.resolve('minio')"], {
    cwd: SERVICE_DIR, stdio: 'ignore',
  }).status === 0;
  if (resolvable) {
    console.log('  minio already resolvable (declared dep, installed by npm ci) — skipping install');
  } else {
    const inst = spawnSync(
      'npm',
      ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund',
        '-w', 'services/storage-auth', 'minio@^8.0.7'],
      { stdio: 'inherit' },
    );
    if (inst.status !== 0) throw new Error('failed to install the minio client for the integration suite');
  }

  console.log('▶ running integration suite (vitest.it.config.ts)…');
  const run = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.it.config.ts'], {
    cwd: SERVICE_DIR,
    stdio: 'inherit',
    env: testEnv,
  });
  process.exitCode = run.status ?? 1;
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  if (started) {
    console.log('▼ tearing down clamd + minio…');
    rm(CLAMD_NAME);
    rm(MINIO_NAME);
  }
}
