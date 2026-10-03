/**
 * deploy/connectors/local.mjs — Local Docker Compose Connector
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs docker compose locally. Works for:
 *   - Local development (docker-compose.local.yml)
 *   - minikube with docker driver
 *   - Any local Docker daemon
 *
 * Manifest config (optional overrides):
 *   connectors:
 *     local:
 *       compose_file: docker-compose.local.yml   # default
 *       env_file: .env.local                     # optional
 *
 * Usage:
 *   aisha-ctl --connector=local status
 *   aisha-ctl --connector=local deploy core --wait
 *   aisha-ctl --connector=local logs core
 *   aisha-ctl --connector=local logs core --follow   # tail -f
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { execSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

export const name = "local";
export const description = "Local docker compose (dev, minikube, CI)";

// ─── Config ──────────────────────────────────────────────────────────────────
function localConfig(appName, cfg, globalCfg, repoRoot) {
  const localGlobal = globalCfg?.connectors?.local || {};
  const composeFile = cfg.local_compose_file
    || localGlobal.compose_file
    || "docker-compose.local.yml";
  const envFile = localGlobal.env_file || ".env.local";
  const composeFilePath = resolve(repoRoot, composeFile);
  const envFilePath = resolve(repoRoot, envFile);
  return { composeFile, composeFilePath, envFile, envFilePath };
}

function run(cmd, { cwd, timeout = 60_000, capture = true } = {}) {
  const opts = { encoding: "utf8", timeout, cwd };
  if (!capture) {
    opts.stdio = "inherit";
    execSync(cmd, opts);
    return "";
  }
  return execSync(cmd, opts).trim();
}

// ─── status ───────────────────────────────────────────────────────────────────
export async function status(appName, cfg, _token, globalCfg, repoRoot) {
  const containerName = `aisha-${appName}`;
  try {
    const out = run(
      `docker inspect --format='{{.State.Status}}:{{.State.Health.Status}}' ${containerName} 2>/dev/null || echo not_found`
    );
    if (out === "not_found" || out === "") return { status: "NOT_FOUND", running: false, healthy: false };
    const [state, health] = out.split(":");
    return {
      status: `${state}:${health || "unknown"}`,
      running: state === "running",
      healthy: state === "running" && health === "healthy",
      lastDeploy: null,
    };
  } catch (e) {
    return { status: `ERROR:${e.message.slice(0, 50)}`, running: false, healthy: false };
  }
}

// ─── deploy ───────────────────────────────────────────────────────────────────
export async function deploy(appName, cfg, _token, { force = false } = {}, globalCfg, repoRoot) {
  const { composeFilePath, envFilePath } = localConfig(appName, cfg, globalCfg, repoRoot);

  if (!existsSync(composeFilePath)) {
    throw new Error(`Compose file not found: ${composeFilePath}`);
  }

  const envFlag = existsSync(envFilePath) ? `--env-file ${envFilePath}` : "";
  const pullFlag = force ? "--pull always" : "";
  const cmd = `docker compose -f ${composeFilePath} ${envFlag} up -d ${pullFlag} --remove-orphans 2>&1`;

  console.log(`  $ ${cmd}`);
  run(cmd, { cwd: repoRoot, timeout: 300_000, capture: false });

  return { deploymentId: `local-${Date.now()}` };
}

// ─── waitDeployment ────────────────────────────────────────────────────────────
export async function waitDeployment(appName, cfg, _token, deploymentId, { timeoutMs = 120_000, intervalMs = 3_000, onProgress } = {}, globalCfg, repoRoot) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await status(appName, cfg, null, globalCfg, repoRoot);
    onProgress?.({ status: s.status, changed: true });
    if (s.healthy) return { ok: true, status: s.status };
    if (s.status === "NOT_FOUND") return { ok: false, status: "not_found" };
    if (s.status.startsWith("exited")) return { ok: false, status: s.status };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, status: "timeout" };
}

// ─── logs ─────────────────────────────────────────────────────────────────────
export async function logs(appName, cfg, _token, { lines = 200, follow = false } = {}, globalCfg, repoRoot) {
  const containerName = `aisha-${appName}`;

  if (follow) {
    // tail -f mode — blocking
    run(`docker logs --tail ${lines} --timestamps -f ${containerName}`, { timeout: 0, capture: false });
    return "";
  }

  return run(`docker logs --tail ${lines} --timestamps ${containerName} 2>&1`, { timeout: 30_000 });
}

// ─── getEnvs ─────────────────────────────────────────────────────────────────
export async function getEnvs(appName, cfg, _token, globalCfg, repoRoot) {
  const containerName = `aisha-${appName}`;
  try {
    const out = run(`docker inspect --format='{{range .Config.Env}}{{.}}\n{{end}}' ${containerName} 2>/dev/null`);
    return out.split("\n")
      .filter((l) => l && l.includes("="))
      .map((l) => {
        const idx = l.indexOf("=");
        return { key: l.slice(0, idx), value: l.slice(idx + 1), is_literal: false };
      });
  } catch {
    return [];
  }
}

// ─── setEnv — not supported for local (env comes from compose/env-file) ──────
export async function setEnv(appName, cfg, _token, key, value, globalCfg, repoRoot) {
  throw new Error(
    `setEnv not supported for 'local' connector.\n` +
    `  Edit your .env.local file and redeploy: aisha-ctl --connector=local deploy ${appName}`
  );
}

// ─── restart ─────────────────────────────────────────────────────────────────
export async function restart(appName, cfg, _token, globalCfg, repoRoot) {
  const { composeFilePath } = localConfig(appName, cfg, globalCfg, repoRoot);
  const containerName = `aisha-${appName}`;
  run(`docker compose -f ${composeFilePath} restart ${containerName} 2>&1`, { cwd: repoRoot, capture: false });
}
