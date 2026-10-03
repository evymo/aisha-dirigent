/**
 * deploy/connectors/ssh.mjs — SSH + Docker Compose Connector
 * ─────────────────────────────────────────────────────────────────────────────
 * Deploys AISHA apps directly via SSH using docker compose.
 * No Coolify required — just a remote host with Docker installed.
 *
 * Manifest config required in deploy/aisha-stack.yml:
 *   connectors:
 *     ssh:
 *       host: user@myserver.example.com
 *       key: ~/.ssh/id_rsa             # optional, uses ssh-agent by default
 *       compose_dir: /opt/aisha        # where compose files live on remote
 *       repo_dir: /opt/aisha/repo      # git repo root on remote (for compose files)
 *
 * OR per-app override:
 *   apps:
 *     core:
 *       ssh_host: user@other-host
 *       compose_file: docker-compose.coolify.yml
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Env vars: deployment env vars are read from .env-prod-backup and synced
 *           via `docker compose --env-file` on the remote.
 *
 * Usage:
 *   aisha-ctl --connector=ssh status
 *   aisha-ctl --connector=ssh deploy core --wait
 *   aisha-ctl --connector=ssh logs core
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { execSync, spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir, homedir } from "os";

export const name = "ssh";
export const description = "Direct SSH + docker compose (no Coolify needed)";

// ─── Managed known_hosts ─────────────────────────────────────────────────────
// TOFU host-key pinning: pin the key on first connect (accept-new) and verify
// it on every subsequent connect. A managed known_hosts file keeps the pin
// stable across runs instead of blindly accepting ANY presented host key
// (which enables MITM). Override the location via AISHA_SSH_KNOWN_HOSTS.
const KNOWN_HOSTS =
  process.env.AISHA_SSH_KNOWN_HOSTS ||
  join(homedir(), ".aisha", "ssh", "known_hosts");

function ensureKnownHosts() {
  try {
    mkdirSync(dirname(KNOWN_HOSTS), { recursive: true });
  } catch {
    /* best-effort — ssh will surface a clear error if unwritable */
  }
  return KNOWN_HOSTS;
}

// ─── SSH exec helper ──────────────────────────────────────────────────────────
function sshExec(host, command, { key, timeout = 30_000, capture = true } = {}) {
  const keyFlag = key ? `-i ${key}` : "";
  const knownHosts = ensureKnownHosts();
  const sshCmd = `ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${JSON.stringify(knownHosts)} -o BatchMode=yes -o ConnectTimeout=10 ${keyFlag} ${host} ${JSON.stringify(command)}`;

  if (capture) {
    return execSync(sshCmd, { timeout, encoding: "utf8" }).trim();
  } else {
    execSync(sshCmd, { timeout, stdio: "inherit" });
  }
}

// ─── Resolve SSH config from manifest ────────────────────────────────────────
function sshConfig(appName, cfg, globalCfg) {
  const sshGlobal = globalCfg?.connectors?.ssh || {};
  return {
    host: cfg.ssh_host || sshGlobal.host,
    key: cfg.ssh_key || sshGlobal.key,
    repoDir: cfg.ssh_repo_dir || sshGlobal.repo_dir || "/opt/aisha",
    composeFile: cfg.compose_file || `docker-compose.coolify.yml`,
  };
}

// ─── status ───────────────────────────────────────────────────────────────────
export async function status(appName, cfg, _token, globalCfg) {
  const { host, key, repoDir, composeFile } = sshConfig(appName, cfg, globalCfg);
  if (!host) throw new Error(`SSH connector: no host configured for app '${appName}'`);

  try {
    const containerName = `aisha-${appName}`;
    const out = sshExec(host,
      `docker inspect --format='{{.State.Status}}:{{.State.Health.Status}}' ${containerName} 2>/dev/null || echo "not_found"`,
      { key }
    );
    const [state, health] = out.split(":");
    if (state === "not_found" || state === "") return { status: "NOT_FOUND", running: false, healthy: false };
    const status = `${state}:${health || "unknown"}`;
    return {
      status,
      running: state === "running",
      healthy: state === "running" && health === "healthy",
      lastDeploy: null,
    };
  } catch (e) {
    return { status: `ERROR: ${e.message}`, running: false, healthy: false };
  }
}

// ─── deploy ───────────────────────────────────────────────────────────────────
export async function deploy(appName, cfg, _token, { force = false } = {}, globalCfg) {
  const { host, key, repoDir, composeFile } = sshConfig(appName, cfg, globalCfg);
  if (!host) throw new Error(`SSH connector: no host configured for app '${appName}'`);

  const pullFlag = force ? "--pull always" : "";

  // Pull latest repo state on remote
  const pullCmd = `cd ${repoDir} && git pull --ff-only 2>&1 | tail -3`;
  const gitOut = sshExec(host, pullCmd, { key, timeout: 60_000 });
  console.log(`  git: ${gitOut}`);

  // docker compose up
  const upCmd = [
    `cd ${repoDir}`,
    `docker compose -f ${composeFile} ${pullFlag} up -d --remove-orphans 2>&1`,
  ].join(" && ");

  const upOut = sshExec(host, upCmd, { key, timeout: 180_000 });
  console.log(upOut);

  return { deploymentId: `ssh-${Date.now()}` };
}

// ─── waitDeployment ────────────────────────────────────────────────────────────
// SSH deploys are synchronous (docker compose up blocks until started),
// so we just poll container health for a bit.
export async function waitDeployment(appName, cfg, _token, deploymentId, { timeoutMs = 120_000, intervalMs = 5_000, onProgress } = {}, globalCfg) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await status(appName, cfg, null, globalCfg);
    onProgress?.({ status: s.status, changed: true });
    if (s.healthy) return { ok: true, status: s.status };
    if (!s.running && s.status !== "NOT_FOUND") {
      // container exited
      return { ok: false, status: s.status };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, status: "timeout" };
}

// ─── logs ─────────────────────────────────────────────────────────────────────
export async function logs(appName, cfg, _token, { lines = 200 } = {}, globalCfg) {
  const { host, key } = sshConfig(appName, cfg, globalCfg);
  if (!host) throw new Error(`SSH connector: no host configured for app '${appName}'`);

  const containerName = `aisha-${appName}`;
  const out = sshExec(host,
    `docker logs --tail ${lines} --timestamps ${containerName} 2>&1`,
    { key, timeout: 30_000 }
  );
  return out;
}

// ─── getEnvs ─────────────────────────────────────────────────────────────────
export async function getEnvs(appName, cfg, _token, globalCfg) {
  const { host, key, repoDir } = sshConfig(appName, cfg, globalCfg);
  if (!host) throw new Error(`SSH connector: no host for '${appName}'`);

  try {
    const out = sshExec(host,
      `cat ${repoDir}/.env 2>/dev/null || echo ""`,
      { key }
    );
    return out.split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const idx = l.indexOf("=");
        return { key: l.slice(0, idx), value: l.slice(idx + 1), is_literal: true };
      });
  } catch {
    return [];
  }
}

// ─── setEnv ──────────────────────────────────────────────────────────────────
export async function setEnv(appName, cfg, _token, key, value, globalCfg) {
  const { host, key: sshKey, repoDir } = sshConfig(appName, cfg, globalCfg);
  if (!host) throw new Error(`SSH connector: no host for '${appName}'`);

  // Update or append in .env file
  const escVal = value.replace(/'/g, "'\\''");
  const cmd = [
    `cd ${repoDir}`,
    `if grep -q "^${key}=" .env 2>/dev/null; then`,
    `  sed -i "s|^${key}=.*|${key}=${escVal}|" .env`,
    `else`,
    `  echo "${key}=${escVal}" >> .env`,
    `fi`,
  ].join("\n");

  sshExec(host, cmd, { key: sshKey });
}

// ─── restart ─────────────────────────────────────────────────────────────────
export async function restart(appName, cfg, _token, globalCfg) {
  const { host, key, repoDir, composeFile } = sshConfig(appName, cfg, globalCfg);
  const containerName = `aisha-${appName}`;
  sshExec(host,
    `cd ${repoDir} && docker compose -f ${composeFile} restart ${containerName} 2>&1`,
    { key, timeout: 60_000 }
  );
}
