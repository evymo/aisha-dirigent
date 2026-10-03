/**
 * svc-playwright-runner worker loop.
 *
 *   1. Poll /rpc/get_next_playwright_run (service-role JWT). Sleep & retry.
 *   2. /rpc/mark_playwright_run_running.
 *   3. Spawn `npx playwright test --reporter=json,html` with PLAYWRIGHT_BASE_URL.
 *   4. Upload report dir to storage bucket `e2e-reports/<run_id>/`.
 *   5. /rpc/record_playwright_result with counts + report path.
 *   6. Loop.
 *
 * Heartbeat: writes config.heartbeatPath before each poll so the compose
 * healthcheck (≤ 2× poll interval staleness) stays green during long runs.
 */
/* eslint-disable security/detect-non-literal-fs-filename --
 * Every fs path in this worker is trusted: report dirs are `join(reportBase,
 * job.id)` where reportBase is a deploy env constant and job.id is uuid-
 * validated (runOne); upload/parse paths are readdir entries of the runner's
 * OWN output tree; heartbeatPath/playwrightConfig are env constants. No
 * external (request/user) input reaches a path here. */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative, extname } from 'node:path';
import { config, log } from './config.js';

interface Job {
  id: string;
  trigger_kind: 'staging_auto' | 'production_manual' | 'scheduled';
  target_env: string;
  target_base_url: string;
  suite: string;
  deploy_ref: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const url = `${config.gatewayUrl.replace(/\/$/, '')}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: config.postgrestServiceToken,
      authorization: `Bearer ${config.postgrestServiceToken}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`rpc/${fn} → ${res.status} ${text}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

async function uploadFile(localPath: string, remoteKey: string): Promise<void> {
  const ext = extname(localPath).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const body = await readFile(localPath);
  const url = `${config.gatewayUrl.replace(/\/$/, '')}/storage/v1/object/e2e-reports/${remoteKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: config.postgrestServiceToken,
      authorization: `Bearer ${config.postgrestServiceToken}`,
      'content-type': contentType,
      'x-upsert': 'true',
    },
    body,
  });
  if (!res.ok) {
    log.safeWarn("warn", { msg: 'upload failed', remoteKey, status: res.status });
  }
}

async function uploadDir(localDir: string, remotePrefix: string): Promise<void> {
  if (!existsSync(localDir)) return;
  const entries = await readdir(localDir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(localDir, e.name);
    if (e.isDirectory()) {
      await uploadDir(full, `${remotePrefix}/${e.name}`);
    } else {
      const rel = relative(localDir, full);
      await uploadFile(full, `${remotePrefix}/${rel}`);
    }
  }
}

interface PlaywrightStats {
  expected?: number;
  unexpected?: number;
  passed?: number;
  skipped?: number;
}

async function parseResults(jsonPath: string): Promise<{ total: number; passed: number; failed: number; skipped: number }> {
  if (!existsSync(jsonPath)) return { total: 0, passed: 0, failed: 0, skipped: 0 };
  const raw = await readFile(jsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as { stats?: PlaywrightStats };
  const stats = parsed.stats ?? {};
  const total = stats.expected ?? 0;
  const skipped = stats.skipped ?? 0;
  const failed = stats.unexpected ?? 0;
  const passed = stats.passed ?? Math.max(0, total - failed - skipped);
  return { total, passed, failed, skipped };
}

function spawnPlaywright(reportDir: string, baseUrl: string, suite: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      'playwright',
      'test',
      `--config=${config.playwrightConfig}`,
      '--reporter=json,html',
      `--output=${reportDir}/test-results`,
    ];
    if (suite !== 'all') args.push(suite);
    const child = spawn('npx', args, {
      cwd: '/app',
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: baseUrl,
        PLAYWRIGHT_HTML_REPORT: `${reportDir}/html`,
        PLAYWRIGHT_JSON_OUTPUT_NAME: `${reportDir}/results.json`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logChunks: string[] = [];
    child.stdout.on('data', (b: Buffer) => logChunks.push(b.toString('utf-8')));
    child.stderr.on('data', (b: Buffer) => logChunks.push(b.toString('utf-8')));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`playwright timeout after ${config.runTimeoutS}s`));
    }, config.runTimeoutS * 1000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      void writeFile(`${reportDir}/runner.log`, logChunks.join(''));
      resolve(code ?? 1);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function runOne(): Promise<boolean> {
  const rows = await rpc<Job[]>('get_next_playwright_run', {});
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const job = rows[0];

  // job.id is a uuid PK (playwright_runs.id uuid DEFAULT gen_random_uuid()), so
  // it can't carry path separators today — but it's joined into a filesystem
  // path below. Assert the shape locally so a future RPC/view change that
  // returned a non-uuid string can't turn `join(reportBase, job.id)` into a
  // traversal. Defense in depth; the DB type is the primary guarantee.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.id)) {
    log.safeInfo("error", { msg: 'rejected job: id is not a uuid', run_id: job.id });
    return false;
  }

  log.safeInfo("info", { msg: 'picked job', run_id: job.id, target: job.target_base_url, suite: job.suite });
  await rpc('mark_playwright_run_running', { p_run_id: job.id });

  const reportDir = join(config.reportBase, job.id);
  await mkdir(reportDir, { recursive: true });

  const started = Date.now();
  let exitCode = 1;
  let errorMessage: string | null = null;
  try {
    exitCode = await spawnPlaywright(reportDir, job.target_base_url, job.suite);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    log.safeWarn("warn", { msg: 'playwright spawn error', run_id: job.id, error: errorMessage });
  }
  const durationMs = Date.now() - started;

  const counts = await parseResults(join(reportDir, 'results.json'));
  if (counts.total === 0 && errorMessage === null) {
    errorMessage = 'no results.json produced — see runner.log';
  }

  await uploadDir(reportDir, job.id);

  await rpc('record_playwright_result', {
    p_run_id: job.id,
    p_total: counts.total,
    p_passed: counts.passed,
    p_failed: counts.failed,
    p_skipped: counts.skipped,
    p_duration_ms: durationMs,
    p_report_storage_path: `e2e-reports/${job.id}/html/index.html`,
    p_trace_json_path: `e2e-reports/${job.id}/results.json`,
    p_error_message: errorMessage,
    p_metadata: { deploy_ref: job.deploy_ref, runner_exit_code: exitCode },
  });

  log.safeInfo("info", { msg: 'run finished', run_id: job.id, ...counts, duration_ms: durationMs });
  return true;
}

async function heartbeat(): Promise<void> {
  try {
    await writeFile(config.heartbeatPath, String(Date.now()));
  } catch {
    // heartbeat is best-effort
  }
}

let shuttingDown = false;
process.on('SIGTERM', () => {
  shuttingDown = true;
  log.safeInfo("info", { msg: 'received SIGTERM, will exit after current run' });
});
process.on('SIGINT', () => {
  shuttingDown = true;
  log.safeInfo("info", { msg: 'received SIGINT, will exit after current run' });
});

async function main(): Promise<void> {
  log.safeInfo("info", { msg: 'svc-playwright-runner starting', gateway: config.gatewayUrl, poll_s: config.pollS });
  while (!shuttingDown) {
    await heartbeat();
    try {
      const handled = await runOne();
      if (!handled) {
        await new Promise((r) => setTimeout(r, config.pollS * 1000));
      }
    } catch (err) {
      log.safeWarn("warn", { msg: 'loop iteration error', error: err instanceof Error ? err.message : String(err) });
      await new Promise((r) => setTimeout(r, config.pollS * 1000));
    }
  }
  log.safeInfo("info", { msg: 'svc-playwright-runner exited cleanly' });
}

void main();
