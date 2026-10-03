#!/usr/bin/env node
/**
 * setup-cockpit/host.mjs — Local Setup Cockpit Host
 *
 * Zero-dependency Node.js HTTP server on localhost that bridges the
 * browser-based wizard UI to local system actions. Designed to run
 * BEFORE npm install — uses only Node built-ins.
 *
 * Serves the cockpit static files and exposes a JSON API for:
 *   - OS / hardware detection
 *   - Prerequisite checks
 *   - Running whitelisted setup scripts
 *   - Writing to local .env files only
 *   - Extension build / package / install
 *   - Health checks for Docker, the AISHA stack, and LLM backends
 *
 * Security:
 *   - Binds ONLY to 127.0.0.1 (never 0.0.0.0)
 *   - CORS restricted to same origin
 *   - Outbound limited to PUBLIC endpoints (provider key validation + the
 *     backend's public .well-known bootstrap config); no secrets are sent
 *   - Script execution limited to a whitelist
 */

import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { platform, arch, totalmem, homedir, hostname, cpus } from "node:os";
import { toJson as operatorInputsSchema } from "../lib/operator-inputs.mjs";
import { porovnej } from "../lib/razeni.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const STATIC_DIR = resolve(__dirname, "ui");
const PORT = parseInt(process.env.COCKPIT_PORT || "19840", 10);

// ── MIME types ──────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

// ── Whitelisted scripts (only these can be executed) ────────────────────────
const ALLOWED_SCRIPTS = new Map([
  ["prerequisites", { cmd: "bash", args: [resolve(__dirname, "actions/check-prerequisites.sh")] }],
  ["prerequisites-install", { cmd: "bash", args: [resolve(__dirname, "actions/check-prerequisites.sh"), "--install"] }],
  ["prerequisites-install-node", { cmd: "bash", args: [resolve(__dirname, "actions/check-prerequisites.sh"), "--install", "node"] }],
  ["prerequisites-install-docker", { cmd: "bash", args: [resolve(__dirname, "actions/check-prerequisites.sh"), "--install", "docker"] }],
  ["prerequisites-install-git", { cmd: "bash", args: [resolve(__dirname, "actions/check-prerequisites.sh"), "--install", "git"] }],
  ["prerequisites-install-vscode", { cmd: "bash", args: [resolve(__dirname, "actions/check-prerequisites.sh"), "--install", "vscode"] }],
  ["prerequisites-install-ollama", { cmd: "bash", args: [resolve(__dirname, "actions/check-prerequisites.sh"), "--install", "ollama"] }],
  ["operator-setup-verify", { cmd: process.execPath, args: [resolve(PROJECT_ROOT, "scripts/operator-setup.mjs"), "--verify"] }],
  ["hw-detect", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/auto-select.sh"), "--json"] }],
  ["setup-core", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/setup.sh"), "--skip-dev"] }],
  ["setup-n8n", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/setup.sh"), "--with-n8n", "--skip-dev"] }],
  ["setup-backend", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/setup.sh"), "--with-backend", "--skip-dev"] }],
  ["setup-full", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/setup.sh"), "--full", "--skip-dev"] }],
  ["extension-install-deps", { cmd: "npm", args: ["install", "--no-fund", "--no-audit"], cwd: resolve(PROJECT_ROOT, "extensions/aisha-dirigent") }],
  ["extension-compile", { cmd: "npm", args: ["run", "compile"], cwd: resolve(PROJECT_ROOT, "extensions/aisha-dirigent") }],
  ["extension-package", { cmd: "npx", args: ["@vscode/vsce", "package", "--no-dependencies"], cwd: resolve(PROJECT_ROOT, "extensions/aisha-dirigent") }],
  ["extension-install", { cmd: "code", args: ["--install-extension"], dynamic: true }],
  ["models-wizard-show", { cmd: "node", args: [resolve(PROJECT_ROOT, "scripts/models-wizard.mjs"), "--show"] }],
  ["ai-auto-select", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/auto-select.sh")] }],
  ["ai-auto-install", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/auto-select.sh"), "--install"] }],
  ["ai-mode-local", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/mode-switch.sh"), "local"] }],
  ["ai-mode-hybrid", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/mode-switch.sh"), "hybrid"] }],
  ["ai-mode-cloud", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/mode-switch.sh"), "cloud"] }],
  ["ollama-setup", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/setup-ollama.sh")] }],
  ["ollama-check", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/setup-ollama.sh"), "--check"] }],
  ["docker-ai-setup", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/setup-docker.sh")] }],
  ["docker-ai-check", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/setup-docker.sh"), "--check"] }],
  ["mlx-setup", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/setup-mlx.sh"), "--auto"] }],
  ["mlx-check", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/ai/setup-mlx.sh"), "--check"] }],
  ["warmup-status", { cmd: "bash", args: [resolve(PROJECT_ROOT, "scripts/warmup.sh"), "--status"] }],
  ["npm-install", { cmd: "npm", args: ["install", "--no-fund", "--no-audit"], cwd: PROJECT_ROOT }],
  ["stack-status", { cmd: "docker", args: ["compose", "-f", resolve(PROJECT_ROOT, "docker-compose.coolify.yml"), "ps", "--format", "json"], cwd: PROJECT_ROOT }],
  ["db-migrate-local", { cmd: "node", args: [resolve(PROJECT_ROOT, "scripts/db/migrate.mjs"), "--local"], cwd: PROJECT_ROOT }],
  ["db-seed-local", { cmd: "node", args: [resolve(PROJECT_ROOT, "scripts/db/seed.mjs"), "--local"], cwd: PROJECT_ROOT }],
  ["dirigent-bootstrap", { cmd: "node", args: [resolve(PROJECT_ROOT, "scripts/dirigent/bootstrap-config.mjs")], cwd: PROJECT_ROOT }],
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function detectOS() {
  const p = platform();
  const a = arch();
  const ram = Math.round(totalmem() / (1024 ** 3));
  const cpu = cpus();
  const isAppleSilicon = p === "darwin" && a === "arm64";
  const isWSL = p === "linux" && existsSync("/proc/version") &&
    readFileSync("/proc/version", "utf-8").toLowerCase().includes("microsoft");

  return {
    platform: p,
    arch: a,
    ramGb: ram,
    hostname: hostname(),
    cpuModel: cpu[0]?.model ?? "unknown",
    cpuCores: cpu.length,
    isAppleSilicon,
    isWSL,
    homeDir: homedir(),
    projectRoot: PROJECT_ROOT,
    nodeVersion: process.version,
  };
}

function checkFileExists(relPath) {
  return existsSync(resolve(PROJECT_ROOT, relPath));
}

/** Run a whitelisted script and stream output via SSE. */
function runScript(scriptId, res, extraArgs = []) {
  const entry = ALLOWED_SCRIPTS.get(scriptId);
  if (!entry) {
    jsonResponse(res, { error: `Unknown script: ${scriptId}` }, 400);
    return;
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Native Windows can't run the bash-based actions — guide to WSL instead of a
  // cryptic spawn ENOENT. Inside WSL platform() is "linux", so this only trips
  // on genuine native-Windows hosts (macOS / Linux / WSL are unaffected).
  if (entry.cmd === "bash" && platform() === "win32") {
    res.write(`data: ${JSON.stringify({ type: "error", text: "Tento krok používá bash skript, který na nativním Windows neběží. Spusťte cockpit uvnitř WSL (Ubuntu) — viz README." })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done", text: "1" })}\n\n`);
    res.end();
    return;
  }

  const args = [...entry.args];

  // For extension-install, append the VSIX path
  if (entry.dynamic && scriptId === "extension-install") {
    const extDir = resolve(PROJECT_ROOT, "extensions/aisha-dirigent");
    try {
      const files = readdirSync(extDir)
        .filter(f => f.endsWith(".vsix"))
        .sort()
        .reverse();
      if (files.length > 0) {
        args.push(resolve(extDir, files[0]));
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", text: "No .vsix file found. Run extension-package first." })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done", code: 1 })}\n\n`);
        res.end();
        return;
      }
    } catch (err) {
      console.warn("[cockpit] Cannot read extension directory:", err.message);
      res.write(`data: ${JSON.stringify({ type: "error", text: "Cannot read extension directory" })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done", code: 1 })}\n\n`);
      res.end();
      return;
    }
  }

  args.push(...extraArgs);

  const child = spawn(entry.cmd, args, {
    cwd: entry.cwd || PROJECT_ROOT,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const sendLine = (type, text) => {
    res.write(`data: ${JSON.stringify({ type, text })}\n\n`);
  };

  let buffer = "";
  const flush = (type, chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) sendLine(type, line);
    }
  };

  child.stdout.on("data", (d) => flush("stdout", d.toString()));
  child.stderr.on("data", (d) => flush("stderr", d.toString()));

  child.on("close", (code) => {
    if (buffer.length > 0) sendLine("stdout", buffer);
    sendLine("done", String(code ?? 0));
    res.end();
  });

  child.on("error", (err) => {
    sendLine("error", err.message);
    sendLine("done", "1");
    res.end();
  });

  // If client disconnects, kill the child
  res.on("close", () => {
    if (!child.killed) child.kill("SIGTERM");
  });
}

// ── ENV file operations (local only) ────────────────────────────────────────

// .env-prod-backup is the secrets home cold-start reads; allowing it here lets
// the workbench detect real-deploy presence and persist secrets where cold-start
// expects them (localhost-only server; the GET path masks secret values).
const ALLOWED_ENV_FILES = new Set([".env", ".env.local", ".env-prod-backup"]);

function readEnvFile(relPath) {
  if (!ALLOWED_ENV_FILES.has(relPath)) return null;
  const absPath = resolve(PROJECT_ROOT, relPath);
  if (!existsSync(absPath)) return {};
  const env = {};
  for (const line of readFileSync(absPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function updateEnvFile(relPath, updates) {
  if (!ALLOWED_ENV_FILES.has(relPath)) return false;
  const absPath = resolve(PROJECT_ROOT, relPath);
  // Create the env file if missing so first-run onboarding (empty .env.local)
  // can persist the operator's inputs instead of silently failing.
  let content = existsSync(absPath) ? readFileSync(absPath, "utf-8") : "";
  let changed = false;

  for (const [key, value] of Object.entries(updates)) {
    // Validate key format (prevent injection)
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    const regex = new RegExp(`^(${key})=(.*)$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `$1=${value}`);
      changed = true;
    } else {
      content = content.trimEnd() + `\n${key}=${value}\n`;
      changed = true;
    }
  }

  if (changed) writeFileSync(absPath, content);
  return changed;
}

// ── Static file serving ─────────────────────────────────────────────────────

async function serveStatic(url, res) {
  let filePath = url === "/" ? "/index.html" : url;
  // Prevent directory traversal
  if (filePath.includes("..")) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  const absPath = join(STATIC_DIR, filePath);
  try {
    const data = await readFile(absPath);
    const ext = extname(absPath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch (err) {
    console.warn(`[cockpit] Static file not found: ${filePath}`, err.message);
    res.writeHead(404);
    res.end("Not found");
  }
}

// ── Template gallery ────────────────────────────────────────────────────────
// Lists the brand-neutral starting templates under domains/templates/ so the
// wizard can offer "pick a template as your starting point". Read-only.
// A folder qualifies if it has manifest.json + index.html (the gitignored
// operator domain / a README-only folder is skipped). Human-readable name +
// description come from the EN values in i18n.json; swatch colours from tokens.css.
function listTemplates() {
  const dir = resolve(PROJECT_ROOT, "domains/templates");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const base = join(dir, name);
    const manifestPath = join(base, "manifest.json");
    if (!existsSync(manifestPath) || !existsSync(join(base, "index.html"))) continue;
    let manifest = {};
    let i18n = {};
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
    catch (err) { console.warn(`[cockpit] template '${name}': invalid manifest.json:`, err.message); manifest = {}; }
    try {
      const p = join(base, "i18n.json");
      if (existsSync(p)) i18n = JSON.parse(readFileSync(p, "utf8"));
    } catch (err) { console.warn(`[cockpit] template '${name}': invalid i18n.json:`, err.message); i18n = {}; }
    const pages = Array.isArray(manifest.pages) ? manifest.pages : null;
    const titleKey = manifest.title_key || (pages && pages[0] && pages[0].title_key);
    const descKey = manifest.description_key || (pages && pages[0] && pages[0].description_key);
    const text = (key) => {
      const e = key && i18n[key];
      return (e && typeof e === "object" && (e.en || e.cs)) || "";
    };
    let primary = "";
    let accent = "";
    try {
      const tokens = readFileSync(join(base, "tokens.css"), "utf8");
      primary = ((tokens.match(/--color-primary:\s*([^;]+);/) || [])[1] || "").trim();
      accent = ((tokens.match(/--color-accent:\s*([^;]+);/) || [])[1] || "").trim();
    } catch (err) {
      console.warn(`[cockpit] template '${name}': tokens.css unreadable (optional):`, err.message);
    }
    out.push({
      slug: name,
      name: text(titleKey) || name,
      description: text(descKey) || "",
      primary,
      accent,
      pages: pages ? pages.length : 1,
    });
  }
  return out.sort((a, b) => porovnej(a.slug, b.slug));
}

// ── Request routing ─────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  // CORS — same-origin only
  const origin = req.headers.origin;
  if (origin && !origin.includes(`://127.0.0.1:${PORT}`) && !origin.includes(`://localhost:${PORT}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // ── API routes ──
  if (path === "/api/detect") {
    return jsonResponse(res, detectOS());
  }

  if (path === "/api/cloud-config") {
    return jsonResponse(res, await loadCloudConfig());
  }

  if (path === "/api/templates") {
    return jsonResponse(res, { templates: listTemplates() });
  }

  if (path === "/api/status") {
    return jsonResponse(res, {
      hasNodeModules: checkFileExists("node_modules"),
      hasExtensionNodeModules: checkFileExists("extensions/aisha-dirigent/node_modules"),
      hasEnv: checkFileExists(".env"),
      hasEnvLocal: checkFileExists(".env.local"),
      hasExtensionDist: checkFileExists("extensions/aisha-dirigent/dist/extension.js"),
      hasDirigentConfig: checkFileExists(".aisha/dirigent.json"),
      hasGitHubInstructions: checkFileExists(".github/copilot-instructions.md"),
    });
  }

  if (path === "/api/operator-inputs") {
    // The canonical operator-input schema (scripts/lib/operator-inputs.mjs) plus,
    // per key, whether a value already exists in process.env or .env.local — so
    // the "Deploy config" step shows what's still missing. Values are never
    // returned (only presence), so secrets don't leak to the browser.
    const { categories, inputs } = operatorInputsSchema();
    // Presence across every source cold-start reads — so the wizard reflects a
    // REAL deploy (secrets in .env-prod-backup), not just a local .env.local.
    const fromFiles = { ...(readEnvFile(".env") || {}), ...(readEnvFile(".env-prod-backup") || {}), ...(readEnvFile(".env.local") || {}) };
    const present = {};
    for (const i of inputs) {
      if (i.file) continue;
      present[i.key] = Boolean(process.env[i.key] || fromFiles[i.key]);
    }
    return jsonResponse(res, { categories, inputs, present });
  }

  if (path === "/api/env" && req.method === "GET") {
    const file = url.searchParams.get("file") || ".env";
    const data = readEnvFile(file);
    if (data === null) return jsonResponse(res, { error: "File not allowed" }, 403);
    // Mask secret values
    const masked = {};
    for (const [k, v] of Object.entries(data)) {
      if (/KEY|SECRET|TOKEN|PASSWORD/i.test(k) && v.length > 8) {
        masked[k] = v.slice(0, 4) + "…" + v.slice(-4);
      } else {
        masked[k] = v;
      }
    }
    return jsonResponse(res, { file, env: masked });
  }

  if (path === "/api/env" && req.method === "POST") {
    const body = await readBody(req);
    if (!body?.file || !body?.updates) {
      return jsonResponse(res, { error: "Missing file or updates" }, 400);
    }
    const ok = updateEnvFile(body.file, body.updates);
    return jsonResponse(res, { ok });
  }

  if (path === "/api/run" && req.method === "GET") {
    const scriptId = url.searchParams.get("script");
    if (!scriptId) return jsonResponse(res, { error: "Missing script param" }, 400);
    return runScript(scriptId, res);
  }

  if (path === "/api/validate-key" && req.method === "POST") {
    const body = await readBody(req);
    if (!body?.provider || !body?.key) {
      return jsonResponse(res, { error: "Missing provider or key" }, 400);
    }
    const valid = await validateProviderKey(body.provider, body.key);
    return jsonResponse(res, { provider: body.provider, valid });
  }

  if (path === "/api/shutdown" && req.method === "POST") {
    jsonResponse(res, { ok: true });
    setTimeout(() => process.exit(0), 200);
    return;
  }

  // ── Static files ──
  return serveStatic(path, res);
}

// ── Body parser ─────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) { resolve(null); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (err) {
        console.warn("[cockpit] Failed to parse request body:", err.message);
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

// ── Provider key validation (runs locally, never stored server-side) ────────
async function validateProviderKey(provider, key) {
  const configs = {
    openai: { url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } },
    anthropic: {
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.AISHA_ANTHROPIC_PROBE_MODEL || "claude-3-5-haiku-latest", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    },
    google: { url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}` },
    xai: { url: "https://api.x.ai/v1/models", headers: { Authorization: `Bearer ${key}` } },
  };
  const cfg = configs[provider];
  if (!cfg) return false;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(cfg.url, {
      method: cfg.method || "GET",
      headers: cfg.headers || {},
      body: cfg.body || undefined,
      signal: controller.signal,
    });
    if (provider === "anthropic") return resp.status !== 401;
    return resp.ok;
  } catch (err) {
    console.warn(`[cockpit] Provider key validation failed for ${provider}:`, err.message);
    return false;
  }
}

// ── Cloud config (env-based, no hardcoded URLs in client code) ──────────────
const CLOUD_URL = process.env.AISHA_CLOUD_URL;
if (!CLOUD_URL) {
  console.error("ERROR: AISHA_CLOUD_URL not set (env-driven; no hardcoded host)");
  process.exit(1);
}

/**
 * Resolve the cloud connection config (gateway URL + public anon key) from the
 * backend's `.well-known/app-config.json` — the SAME public bootstrap the
 * extension and mobile app use (solves the bootstrap chicken-and-egg). The anon key is a
 * public, RLS-protected key SERVED BY the running stack, so nothing secret lives
 * in the repo. AISHA_CLOUD_ANON_KEY overrides for self-hosted deploys; on an
 * unreachable backend we return an empty key with a reason the UI can surface.
 */
async function loadCloudConfig() {
  const envKey = process.env.AISHA_CLOUD_ANON_KEY || "";
  const bootstrapUrl = `${CLOUD_URL.replace(/\/+$/, "")}/.well-known/app-config.json`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(bootstrapUrl, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${bootstrapUrl}`);
    const cfg = await resp.json();
    const anonKey = (typeof cfg.anon_key === "string" && cfg.anon_key) || envKey;
    return {
      url: (typeof cfg.aisha_url === "string" && cfg.aisha_url) || CLOUD_URL,
      // ask_url = the "AISHA as a model" public /v1 face (ANTHROPIC_BASE_URL for
      // the editor napoj). Served by the backend's app-config bootstrap.
      askUrl: (typeof cfg.ask_url === "string" && cfg.ask_url) || null,
      anonKey,
      webUrl: cfg.web_url || cfg.dashboard_url || null,
      keycloakUrl: cfg.keycloak_url || null,
      source: anonKey ? (cfg.anon_key ? "bootstrap" : "env") : "empty",
    };
  } catch (err) {
    console.warn("[cockpit] Cloud bootstrap fetch failed:", err.message);
    return {
      url: CLOUD_URL,
      askUrl: null,
      anonKey: envKey,
      webUrl: null,
      keycloakUrl: null,
      source: envKey ? "env" : "unreachable",
      error: err.message,
    };
  }
}

// ── Start server ────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error("[cockpit] Error:", err.message);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal server error");
    }
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  ✦ AISHA Setup Cockpit running at ${url}\n`);

  // Auto-open browser if not in CI
  if (!process.env.CI) {
    const openCmd = platform() === "darwin" ? "open" :
      platform() === "win32" ? "start" : "xdg-open";
    try {
      execFile(openCmd, [url], { stdio: "ignore" });
    } catch {
      console.log(`  Open ${url} in your browser to continue.\n`);
    }
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use. Cockpit may already be running.`);
    console.error(`  Open http://127.0.0.1:${PORT} in your browser.\n`);
    process.exit(0);
  }
  throw err;
});
