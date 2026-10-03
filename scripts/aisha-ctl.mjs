#!/usr/bin/env node
/**
 * scripts/aisha-ctl.mjs — AISHA Platform Control Plane
 * Connector-agnostic CLI. Scope: deploy/aisha-stack.yml. Connectors: deploy/connectors/*.mjs
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dir, "..");

const tty = process.stdout.isTTY;
const C = { reset: tty?"\x1b[0m":"", bold: tty?"\x1b[1m":"", red: tty?"\x1b[31m":"", green: tty?"\x1b[32m":"", yellow: tty?"\x1b[33m":"", blue: tty?"\x1b[34m":"", cyan: tty?"\x1b[36m":"", gray: tty?"\x1b[90m":"" };
const c = (col, s) => C[col] + s + C.reset;
const die = (msg) => { console.error(c("red", `✗ ${msg}`)); process.exit(1); };

// ─── Manifest parser ──────────────────────────────────────────────────────────
function parseManifest(text) {
  const manifest = { version: "1", host: {}, groups: {}, deploy_order: [], apps: {}, connectors: {} };
  const lines = text.split("\n");
  let section = null, currentApp = null, currentSection2 = null;

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.search(/\S/);
    const line = raw.trim();

    if (indent === 0) {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (m) { section = m[1]; currentApp = null; currentSection2 = null; }
      continue;
    }

    if (section === "host" && indent === 2) {
      const m = line.match(/^([\w-]+):\s*(.+)$/);
      if (m) manifest.host[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    } else if (section === "groups" && indent === 2) {
      const m = line.match(/^(\w[\w-]*):\s*\[(.+)\]$/);
      if (m) manifest.groups[m[1]] = m[2].split(",").map((s) => s.trim().replace(/['"]/g, ""));
    } else if (section === "deploy_order" && indent === 2 && line.startsWith("- ")) {
      manifest.deploy_order.push(line.slice(2).trim());
    } else if (section === "apps") {
      if (indent === 2) {
        const m = line.match(/^(\w[\w-]*):\s*$/);
        if (m) { currentApp = m[1]; manifest.apps[currentApp] = { depends_on: [] }; }
      } else if (indent === 4 && currentApp) {
        const inlineList = line.match(/^([\w-]+):\s*\[(.+)\]$/);
        if (inlineList) { manifest.apps[currentApp][inlineList[1]] = inlineList[2].split(",").map((s) => s.trim().replace(/['"]/g, "")); continue; }
        const kv = line.match(/^([\w-]+):\s*(.+)$/);
        if (kv) {
          const v = kv[2].replace(/^["']|["']$/g, "").trim();
          manifest.apps[currentApp][kv[1]] = v === "true" ? true : v === "false" ? false : v;
        }
      }
    } else if (section === "connectors") {
      if (indent === 2) {
        const m = line.match(/^(\w[\w-]*):\s*$/);
        if (m) { currentSection2 = m[1]; manifest.connectors[currentSection2] = {}; }
      } else if (indent === 4 && currentSection2) {
        const kv = line.match(/^([\w-]+):\s*(.+)$/);
        if (kv) manifest.connectors[currentSection2][kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
      }
    }
  }
  return manifest;
}

function loadManifest() {
  const path = resolve(REPO, "deploy/aisha-stack.yml");
  if (!existsSync(path)) die("deploy/aisha-stack.yml not found.");
  return parseManifest(readFileSync(path, "utf8"));
}

async function loadConnector(name) {
  const available = ["coolify", "ssh", "local"];
  if (!available.includes(name)) die(`Unknown connector: ${name}. Available: ${available.join(", ")}`);
  return import(resolve(REPO, `deploy/connectors/${name}.mjs`));
}

function appCfg(appName) {
  const cfg = MANIFEST.apps[appName];
  if (!cfg) die(`Unknown app: '${appName}'. Valid: ${Object.keys(MANIFEST.apps).join(", ")}`);
  const apiBase = MANIFEST.host?.api || process.env.COOLIFY_API || (process.env.COOLIFY_URL ? `${process.env.COOLIFY_URL}/api/v1` : "");
  if (!apiBase) die("COOLIFY_API or COOLIFY_URL required (set in .env-prod-backup or MANIFEST.host.api)");
  return { ...cfg, _apiBase: apiBase };
}

function statusColor(s = "") {
  if (s === "running:healthy") return c("green", s);
  if (s.includes("exited") || s.includes("unhealthy") || s.includes("failed") || s === "NOT_FOUND") return c("red", s);
  if (s.includes("starting") || s.includes("restarting") || s.includes("in_progress")) return c("yellow", s);
  return c("gray", s);
}

let MANIFEST, CONNECTOR, CONNECTOR_NAME, TOKEN;

// ─── Commands ─────────────────────────────────────────────────────────────────
async function cmdStatus({ json }) {
  if (!json) console.log(c("gray", `connector: ${CONNECTOR_NAME}`));
  const rows = [];
  for (const name of MANIFEST.deploy_order) {
    const cfg = MANIFEST.apps[name];
    if (!cfg) continue;
    try {
      const s = await CONNECTOR.status(name, appCfg(name), TOKEN, MANIFEST, REPO);
      rows.push({ name, ...s, critical: !!cfg.critical, description: cfg.description || "" });
    } catch (e) {
      rows.push({ name, status: `ERR:${e.message.slice(0,40)}`, running: false, healthy: false, critical: !!cfg.critical, description: "" });
    }
  }

  if (json) { console.log(JSON.stringify(rows, null, 2)); return; }

  console.log();
  console.log(c("bold", c("cyan", "━━━ AISHA Stack Status ━━━")));
  console.log(c("bold", `  ${"APP".padEnd(16)} STATUS`));
  console.log("  " + "─".repeat(60));
  for (const r of rows) {
    const star = r.critical ? c("yellow", " *") : "  ";
    const dep = r.lastDeploy ? c("gray", ` [${r.lastDeploy}]`) : "";
    console.log(`${star} ${r.name.padEnd(15)} ${statusColor(r.status)}${dep}`);
    if (r.description) console.log(`       ${c("gray", r.description)}`);
  }
  console.log();
}

async function cmdLogs(appName, { lines = "200", follow = false }) {
  const cfg = appCfg(appName);
  console.log(c("cyan", `▶ Logs aisha-${appName} (${CONNECTOR_NAME}, last ${lines} lines)...`));
  try {
    const out = await CONNECTOR.logs(appName, cfg, TOKEN, { lines: parseInt(lines), follow }, MANIFEST, REPO);
    console.log(c("gray", "─".repeat(80)));
    console.log(out);
    console.log(c("gray", "─".repeat(80)));
  } catch (e) {
    if (e.message.startsWith("APP_NOT_RUNNING")) { console.error(c("yellow", `⚠  ${e.message}`)); process.exit(1); }
    die(e.message);
  }
}

async function cmdWait(appName, { timeout = "300" }) {
  const cfg = appCfg(appName);
  const timeoutMs = parseInt(timeout) * 1000;
  console.log(c("cyan", `⏳ Waiting for aisha-${appName} (${CONNECTOR_NAME}, ${timeout}s)...`));
  let lastStatus = "";
  const result = await CONNECTOR.waitDeployment(appName, cfg, TOKEN, null, {
    timeoutMs, intervalMs: 5_000,
    onProgress: ({ status, changed }) => {
      if (changed) { process.stdout.write(`\n  → ${statusColor(status)}`); lastStatus = status; }
      else { process.stdout.write("."); }
    },
  }, MANIFEST, REPO);
  console.log();
  if (result.ok) console.log(c("green", `✅ aisha-${appName}: ${result.status}`));
  else console.log(c("red", `✗ aisha-${appName}: ${result.status}`));
  return result.ok;
}

async function cmdDeploy(target, opts) {
  const { wait, force, logs, timeout, yes } = opts;
  let apps;
  if (!target || target === "all") {
    apps = MANIFEST.deploy_order.filter((a) => MANIFEST.apps[a]);
  } else if (target.startsWith("group:")) {
    const group = target.slice(6);
    apps = MANIFEST.groups[group];
    if (!apps) die(`Unknown group: '${group}'. Valid: ${Object.keys(MANIFEST.groups).join(", ")}`);
  } else {
    if (!MANIFEST.apps[target]) die(`Unknown app: '${target}'`);
    apps = [target];
  }

  if (apps.length > 1) {
    console.log(c("bold", c("cyan", `🚀 Deploying ${apps.length} apps via ${CONNECTOR_NAME}: ${apps.join(" → ")}`)));
    if (!yes) {
      const { createInterface } = await import("readline");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((r) => rl.question("Continue? [y/N] ", r));
      rl.close();
      if (!answer.match(/^[yY]/)) { console.log("Aborted."); return; }
    }
  }

  let allOk = true;
  for (const name of apps) {
    const cfg = appCfg(name);
    process.stdout.write(c("blue", `▶ aisha-${name}... `));
    try {
      const { deploymentId } = await CONNECTOR.deploy(name, cfg, TOKEN, { force }, MANIFEST, REPO);
      console.log(c("gray", deploymentId));
    } catch (e) {
      console.log(c("red", `✗ ${e.message}`));
      allOk = false;
      continue;
    }
    if (wait) {
      const ok = await cmdWait(name, { timeout: timeout || "300" });
      if (!ok) allOk = false;
      if (logs) {
        await cmdLogs(name, { lines: opts.lines || "300" }).catch((e) =>
          console.log(c("gray", `  (logs: ${e.message})`))
        );
      }
    }
    if (apps.length > 1) await new Promise((r) => setTimeout(r, 1000));
  }

  if (!wait) {
    console.log();
    console.log(c("gray", `  aisha-ctl status | wait <app> | logs <app>`));
  }
  if (!allOk) process.exit(1);
}

async function cmdDebugHold(appName, state) {
  if (CONNECTOR_NAME !== "coolify") die("debug-hold only supported for coolify connector");
  const cfg = appCfg(appName);
  if (!cfg.debug_env) die(`App '${appName}' has no debug_env in manifest`);
  if (!["on", "off"].includes(state)) die("State must be 'on' or 'off'");
  const value = state === "on" ? "1" : "0";
  console.log(c("cyan", `▶ ${cfg.debug_env}=${value} for aisha-${appName}...`));
  await CONNECTOR.setEnv(appName, cfg, TOKEN, cfg.debug_env, value, MANIFEST, REPO);
  console.log(c("green", `✅ ${cfg.debug_env}=${value}`));
  if (state === "on") {
    console.log(c("yellow", `\n  Debug workflow:`));
    console.log(c("gray",   `    aisha-ctl deploy ${appName} --wait`));
    console.log(c("gray",   `    aisha-ctl logs ${appName} --lines=500`));
    console.log(c("gray",   `    aisha-ctl debug-hold ${appName} off && aisha-ctl deploy ${appName} --wait`));
  }
}

async function cmdEnvGet(appName) {
  const cfg = appCfg(appName);
  const envs = await CONNECTOR.getEnvs(appName, cfg, TOKEN, MANIFEST, REPO);
  console.log(c("bold", `\n  Env vars — aisha-${appName} (${CONNECTOR_NAME}):`));
  for (const e of envs || []) {
    console.log(`  ${(e.key||"").padEnd(38)} ${e.is_literal ? c("gray","[literal]") : (e.value||"").slice(0,50)}`);
  }
  console.log();
}

async function cmdEnvSet(appName, assignment) {
  const idx = assignment.indexOf("=");
  if (idx < 1) die("Usage: env-set <app> KEY=VALUE");
  const key = assignment.slice(0, idx);
  const value = assignment.slice(idx + 1);
  const cfg = appCfg(appName);
  console.log(c("cyan", `▶ Setting ${key} for aisha-${appName}...`));
  await CONNECTOR.setEnv(appName, cfg, TOKEN, key, value, MANIFEST, REPO);
  console.log(c("green", `✅ ${key} set`));
}

async function cmdComposeSync(appName) {
  if (CONNECTOR_NAME !== "coolify") die("compose-sync only supported for coolify connector");
  if (!CONNECTOR.composeSync) die("Connector missing composeSync");
  const cfg = appCfg(appName);
  if (!cfg.compose) die(`App '${appName}' has no compose path in manifest`);
  const composePath = resolve(REPO, cfg.compose);
  const { readFileSync } = await import("fs");
  const content = readFileSync(composePath, "utf8");
  console.log(c("cyan", `▶ Syncing ${cfg.compose} → aisha-${appName}...`));
  console.log(c("gray", `  (${content.length} bytes, ${content.split("\n").length} lines)`));
  const result = await CONNECTOR.composeSync(appName, cfg, TOKEN, content);
  console.log(c("green", `✅ Compose synced for aisha-${appName} (via ${result.field})`));
  console.log(c("yellow", `  Deploy to apply: node scripts/aisha-ctl.mjs deploy ${appName} --force`));
}

async function cmdGroup(group, action, opts) {
  const members = MANIFEST.groups[group];
  if (!members) die(`Unknown group: '${group}'. Valid: ${Object.keys(MANIFEST.groups).join(", ")}`);
  console.log(c("cyan", `▶ Group '${group}': ${members.join(", ")}`));
  for (const app of members) {
    if (!MANIFEST.apps[app]) { console.log(c("yellow", `  ⚠ ${app} not in manifest`)); continue; }
    if (action === "deploy") {
      process.stdout.write(c("blue", `  ▶ aisha-${app}... `));
      try {
        const { deploymentId } = await CONNECTOR.deploy(app, appCfg(app), TOKEN, opts, MANIFEST, REPO);
        console.log(c("gray", deploymentId));
        if (opts.wait) await cmdWait(app, opts);
      } catch (e) {
        console.log(c("red", `✗ ${e.message}`));
      }
    } else {
      const s = await CONNECTOR.status(app, appCfg(app), TOKEN, MANIFEST, REPO);
      console.log(`  ${`aisha-${app}`.padEnd(22)} ${statusColor(s.status)}`);
    }
  }
}

async function cmdRestart(appName) {
  const cfg = appCfg(appName);
  console.log(c("cyan", `▶ Restarting aisha-${appName}...`));
  await CONNECTOR.restart(appName, cfg, TOKEN, MANIFEST, REPO);
  console.log(c("green", `✅ Restart triggered`));
}

function cmdConnectors() {
  console.log(`
${c("bold", "Available connectors:")}

  ${c("green","coolify")}  Coolify REST API (default, production)
            Requires: COOLIFY_API_TOKEN, apps.*.uuid in manifest
            Features: status, deploy, wait, logs*, env-get/set, debug-hold, restart
            * logs only available while app is running

  ${c("green","ssh")}      SSH + docker compose (bare-metal, no Coolify)
            Requires: connectors.ssh.host in manifest (user@host)
            Features: status, deploy, wait, logs, env-get/set (via .env file), restart

  ${c("green","local")}    Local docker compose (dev, minikube, CI)
            Requires: docker-compose.local.yml in repo root
            Features: status, deploy, wait, logs, env-get

Usage: node scripts/aisha-ctl.mjs --connector=<name> <command>
`);
}

function cmdHelp() {
  const apps = Object.keys(MANIFEST?.apps || {}).join(", ");
  const groups = Object.entries(MANIFEST?.groups || {}).map(([k,v]) => `${k}:[${v.join(",")}]`).join("  ");
  console.log(`
${c("bold",c("cyan","aisha-ctl"))} — AISHA Platform Control Plane
${"─".repeat(65)}
Connector: ${c("yellow", CONNECTOR_NAME||"coolify")}   (--connector=coolify|ssh|local)
Manifest:  deploy/aisha-stack.yml

${c("bold","COMMANDS")}
  ${c("green","status")} [--json]
  ${c("green","deploy")} [<app>|all|group:<g>] [--wait] [--force] [--logs] [--timeout=N] [-y]
  ${c("green","logs")} <app> [--lines=N] [--follow]
  ${c("green","wait")} <app> [--timeout=N]
  ${c("green","debug-hold")} <app> [on|off]   (coolify only — keep migrate alive for log inspection)
  ${c("green","env-get")} <app>
  ${c("green","env-set")} <app> KEY=VALUE
  ${c("green","restart")} <app>
  ${c("green","group")} <group> [deploy|status] [--wait] [--force]
  ${c("green","connectors")}                  list connectors and requirements

${c("bold","APPS")}   ${apps}
${c("bold","GROUPS")} ${groups}

${c("bold","DEBUG WORKFLOW (migrate failure)")}
  node scripts/aisha-ctl.mjs debug-hold core on
  node scripts/aisha-ctl.mjs deploy core --wait
  node scripts/aisha-ctl.mjs logs core --lines=500
  node scripts/aisha-ctl.mjs debug-hold core off
  node scripts/aisha-ctl.mjs deploy core --wait
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  MANIFEST = loadManifest();

  const { values: opts, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      connector: { type: "string", default: "coolify" },
      json:      { type: "boolean", default: false },
      wait:      { type: "boolean", default: false },
      force:     { type: "boolean", default: false },
      logs:      { type: "boolean", default: false },
      follow:    { type: "boolean", default: false },
      timeout:   { type: "string" },
      lines:     { type: "string" },
      yes:       { type: "boolean", short: "y", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  CONNECTOR_NAME = opts.connector || "coolify";
  CONNECTOR = await loadConnector(CONNECTOR_NAME);

  if (CONNECTOR_NAME === "coolify") {
    if (!CONNECTOR.resolveToken) die("coolify connector missing resolveToken");
    TOKEN = CONNECTOR.resolveToken(REPO);
  }

  const cmd = positionals[0];
  switch (cmd) {
    case "status":      await cmdStatus(opts); break;
    case "deploy":      await cmdDeploy(positionals[1], opts); break;
    case "logs":        if (!positionals[1]) die("Usage: logs <app>"); await cmdLogs(positionals[1], opts); break;
    case "wait":        if (!positionals[1]) die("Usage: wait <app>"); await cmdWait(positionals[1], opts); break;
    case "debug-hold":  if (!positionals[1]||!positionals[2]) die("Usage: debug-hold <app> [on|off]"); await cmdDebugHold(positionals[1], positionals[2]); break;
    case "env-get":     if (!positionals[1]) die("Usage: env-get <app>"); await cmdEnvGet(positionals[1]); break;
    case "env-set":     if (!positionals[1]||!positionals[2]) die("Usage: env-set <app> KEY=VALUE"); await cmdEnvSet(positionals[1], positionals[2]); break;
    case "group":       if (!positionals[1]||!positionals[2]) die("Usage: group <g> [deploy|status]"); await cmdGroup(positionals[1], positionals[2], opts); break;
    case "restart":     if (!positionals[1]) die("Usage: restart <app>"); await cmdRestart(positionals[1]); break;
    case "compose-sync": if (!positionals[1]) die("Usage: compose-sync <app>"); await cmdComposeSync(positionals[1]); break;
    case "connectors":  cmdConnectors(); break;
    case "help": case "--help": case "-h": case undefined: cmdHelp(); break;
    default: console.error(c("red", `Unknown: ${cmd}`)); cmdHelp(); process.exit(1);
  }
}

main().catch((e) => { console.error(c("red",`✗ ${e.message}`)); if(process.env.DEBUG)console.error(e.stack); process.exit(1); });
