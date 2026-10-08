/**
 * Wiring a repository (this one or any other) to a discovered instance.
 *
 * Writes URLs only — never a token:
 *   .aisha/dirigent.local.json  — the profile the Dirigent extension, the Claude
 *                                 plugin and scripts/dirigent read (same keys the
 *                                 extension's own bootstrap writes); git-ignored
 *   Claude Code MCP server      — `aisha-knowledge`, local scope by default
 *                                 (~/.claude.json, per project, not committed)
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { mergeMcpJson } from "../../lib/mcp-json-merge.mjs";

export const MCP_SERVER_NAME = "aisha-knowledge";
export const DIRIGENT_LOCAL = ".aisha/dirigent.local.json";
/** Claude Code native MCP OAuth client (realm client with a localhost callback). */
export const DEFAULT_MCP_OAUTH_CLIENT_ID = "aisha-mcp-client";
export const DEFAULT_MCP_OAUTH_CALLBACK_PORT = 59876;

/** Profile entry for .aisha/dirigent.local.json. */
export function dirigentProfileFrom(name, profile) {
  const a = profile.appConfig;
  const entry = {
    aishaUrl: a.aisha_url,
    mcpUrl: a.mcp_url,
    // The gateway serves the model endpoint (/v1) — same as the tracked local profile.
    modelEndpoint: a.aisha_url,
    anonKey: a.anon_key,
    keycloakUrl: a.keycloak_url,
    bootstrapUrl: `${profile.apiBase}/.well-known/app-config.json`,
    connectProfile: name,
  };
  if (a.n8n_trigger_url) entry.n8nTriggerUrl = a.n8n_trigger_url;
  if (a.web_url) entry.webUrl = a.web_url;
  return entry;
}

function readJsonObject(file) {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, "utf8");
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Refuse rather than re-seed: the file may hold hand-written profiles.
    throw new Error(`${file} is not valid JSON (${err.message}) — fix it, then re-run`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${file} is not a JSON object`);
  return parsed;
}

/** Upsert the profile and make it active; every other key is preserved. */
export function writeDirigentLocal(repoDir, name, entry, { activate = true } = {}) {
  const file = join(repoDir, DIRIGENT_LOCAL);
  const existing = readJsonObject(file);
  const profiles = existing.profiles && typeof existing.profiles === "object" ? existing.profiles : {};
  const next = {
    ...existing,
    activeProfile: activate ? name : existing.activeProfile || name,
    profiles: { ...profiles, [name]: { ...(profiles[name] || {}), ...entry } },
  };
  mkdirSync(join(repoDir, ".aisha"), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  return file;
}

function isGitRepo(repoDir) {
  const r = spawnSync("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() === "true";
}

/**
 * Make sure the local profile cannot be committed by accident.
 * @returns {"already-ignored"|"added"|"no-git"}
 */
export function ensureGitignored(repoDir, relPath = DIRIGENT_LOCAL) {
  if (!isGitRepo(repoDir)) return "no-git";
  const check = spawnSync("git", ["-C", repoDir, "check-ignore", "-q", relPath]);
  if (check.status === 0) return "already-ignored";
  const gitignore = join(repoDir, ".gitignore");
  const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  appendFileSync(gitignore, `${prefix}# AISHA local profile (aisha-connect) — URLs of your instance\n${relPath}\n`);
  return "added";
}

/** POSIX single-quote / Windows double-quote an argument for a shell command line. */
export function shellQuote(value, platform = process.platform) {
  if (platform === "win32") return `"${String(value).replace(/"/g, '""')}"`;
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Command Claude Code runs to get fresh MCP headers (refreshes the token itself). */
export function headersHelperCommand(cliPath, profileName, { nodePath = process.execPath, platform = process.platform } = {}) {
  return [nodePath, cliPath, "token", "--profile", profileName, "--format", "header"].map((v) => shellQuote(v, platform)).join(" ");
}

/**
 * @param {{ mcpUrl: string, auth: "helper"|"oauth", helperCommand?: string, clientId?: string, callbackPort?: number }} o
 */
export function mcpServerEntry({ mcpUrl, auth, helperCommand, clientId = DEFAULT_MCP_OAUTH_CLIENT_ID, callbackPort = DEFAULT_MCP_OAUTH_CALLBACK_PORT }) {
  if (auth === "helper") {
    if (!helperCommand) throw new Error("helper auth needs a headersHelper command");
    return { type: "http", url: mcpUrl, headersHelper: helperCommand };
  }
  if (auth === "oauth") return { type: "http", url: mcpUrl, oauth: { clientId, callbackPort } };
  throw new Error(`unknown --mcp-auth "${auth}" (helper|oauth)`);
}

/**
 * Upsert the server into the repo's .mcp.json (project scope, usually committed).
 * Only machine-independent entries belong there — never a headersHelper path.
 */
export function writeProjectMcpJson(repoDir, entry) {
  if (entry.headersHelper) {
    throw new Error("a headersHelper entry holds a path on THIS machine — register it in local scope (--mcp local), not in .mcp.json");
  }
  const file = join(repoDir, ".mcp.json");
  readJsonObject(file); // refuse a malformed file instead of re-seeding it
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, mergeMcpJson(existing, MCP_SERVER_NAME, entry));
  return file;
}

/** argv for `claude mcp add-json` (local scope = this project, this user). */
export function claudeAddJsonArgs(entry, scope = "local") {
  return ["mcp", "add-json", "--scope", scope, MCP_SERVER_NAME, JSON.stringify(entry)];
}

/**
 * Register the server with the Claude Code CLI if it is installed.
 * @returns {{ status: "registered"|"no-claude"|"failed", command: string, detail?: string }}
 */
export function registerWithClaude(repoDir, entry, { scope = "local", run = spawnSync } = {}) {
  const args = claudeAddJsonArgs(entry, scope);
  const command = ["claude", ...args.slice(0, -1), shellQuote(args.at(-1), "linux")].join(" ");
  const probe = run("claude", ["--version"], { cwd: repoDir, encoding: "utf8" });
  if (probe.error || probe.status !== 0) return { status: "no-claude", command };
  // add-json refuses to overwrite; drop a previous registration of the same scope first.
  run("claude", ["mcp", "remove", "--scope", scope, MCP_SERVER_NAME], { cwd: repoDir, encoding: "utf8" });
  const r = run("claude", args, { cwd: repoDir, encoding: "utf8" });
  if (r.status === 0) return { status: "registered", command };
  return { status: "failed", command, detail: (r.stderr || r.stdout || "").trim().slice(0, 300) };
}
