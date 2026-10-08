#!/usr/bin/env node
/**
 * aisha-connect — connect local developer tools to an AISHA instance:
 * your local stack (default), a self-hosted AISHA, or the official hosted one.
 *
 *   discover  read the instance's app-config + OIDC discovery into a profile
 *   login     Keycloak device-flow login; tokens stay in your user config dir
 *   init      wire a repository (this one or any other) to a profile
 *   validate  prove the connection end to end (exit 2 on a failed check)
 *   token     print a fresh access token (Claude Code headersHelper uses this)
 *   env/exec  hand URLs + a fresh token to other scripts
 *   status / logout
 *
 * Zero dependencies beyond Node 18+. Run `node scripts/aisha-connect/cli.mjs help`.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertProfileName, discoverInstance, profileNameFromUrl } from "./lib/discovery.mjs";
import {
  DEFAULT_CLIENT_ID,
  DEFAULT_SCOPE,
  ensureFreshCredential,
  LoginRequiredError,
  pollDeviceToken,
  revokeRefreshToken,
  startDeviceAuthorization,
  toCredential,
} from "./lib/oauth.mjs";
import {
  DEFAULT_MCP_OAUTH_CALLBACK_PORT,
  DEFAULT_MCP_OAUTH_CLIENT_ID,
  DIRIGENT_LOCAL,
  dirigentProfileFrom,
  ensureGitignored,
  headersHelperCommand,
  mcpServerEntry,
  registerWithClaude,
  shellQuote,
  writeDirigentLocal,
  writeProjectMcpJson,
} from "./lib/repo-config.mjs";
import { createStore } from "./lib/store.mjs";
import { runValidation, summarize } from "./lib/validate.mjs";

const CLI_PATH = fileURLToPath(import.meta.url);
const EXIT = { ok: 0, error: 1, validation: 2, login: 3 };

const HELP = `aisha-connect — connect local tools (Claude Code, Dirigent, scripts) to an AISHA instance

Usage: node scripts/aisha-connect/cli.mjs <command> [options]

Commands
  discover   [--url <api base>] [--profile <name>] [--default]
  login      [--url <api base>] [--profile <name>] [--client-id <id>] [--offline] [--no-open]
  init       [--profile <name>] [--repo <dir>] [--mcp local|project|none] [--mcp-auth helper|oauth]
             [--mcp-client-id <id>] [--mcp-callback-port <port>]
  validate   [--profile <name>] [--repo <dir>] [--check-mcp-oauth] [--json]
  token      [--profile <name>] [--format raw|header|json]
  env        [--profile <name>] [--with-token] [--shell posix|powershell]
  exec       [--profile <name>] -- <command> [args...]
  status     [--json]
  logout     [--profile <name>]

--url is the instance API base (the host serving /.well-known/app-config.json).
Default: the local stack gateway. Example for a hosted instance:
  aisha-connect login --url https://api.<your-aisha-domain>

Profile: --profile, else $AISHA_PROFILE, else the repo's active profile
(${DIRIGENT_LOCAL}), else the default profile. Tokens live in $AISHA_CONFIG_DIR
(default ~/.config/aisha), never in a repository.

Exit codes: 0 ok · 1 error · 2 validation failed · 3 login required`;

function parseArgs(argv) {
  const flags = { _: [], passthrough: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (cur === "--") {
      flags.passthrough = argv.slice(i + 1);
      break;
    }
    if (!cur.startsWith("--")) {
      flags._.push(cur);
      continue;
    }
    const eq = cur.indexOf("=");
    if (eq > 0) {
      flags[cur.slice(2, eq)] = cur.slice(eq + 1);
      continue;
    }
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const say = (msg = "") => process.stdout.write(`${msg}\n`);
const note = (msg = "") => process.stderr.write(`${msg}\n`);

/** Local stack gateway — the single home of that address is config/local-presets.mjs. */
async function localDefaultUrl() {
  try {
    const { getLocalGatewayUrl } = await import("../../config/local-presets.mjs");
    return getLocalGatewayUrl();
  } catch {
    return null;
  }
}

function repoActiveConnectProfile(repoDir) {
  const file = join(repoDir, DIRIGENT_LOCAL);
  if (!existsSync(file)) return null;
  try {
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    return cfg.profiles?.[cfg.activeProfile]?.connectProfile ?? null;
  } catch {
    return null;
  }
}

function resolveProfileName(flags, store, repoDir) {
  const explicit = str(flags.profile) || str(process.env.AISHA_PROFILE);
  if (explicit) return assertProfileName(explicit);
  const data = store.readProfiles();
  const fromRepo = repoActiveConnectProfile(repoDir);
  if (fromRepo && data.profiles[fromRepo]) return fromRepo;
  if (data.defaultProfile && data.profiles[data.defaultProfile]) return data.defaultProfile;
  const names = Object.keys(data.profiles);
  return names.length === 1 ? names[0] : null;
}

function requireProfile(flags, store, repoDir) {
  const name = resolveProfileName(flags, store, repoDir);
  const profile = name ? store.getProfile(name) : null;
  if (!profile) {
    const known = Object.keys(store.readProfiles().profiles);
    throw new UsageError(
      name
        ? `no profile "${name}" — run: aisha-connect login --url <api base> --profile ${name}`
        : known.length
          ? `several profiles (${known.join(", ")}) — pick one with --profile`
          : "no profile yet — run: aisha-connect login [--url <api base>]",
    );
  }
  return { name, profile };
}

class UsageError extends Error {}

/** discover (and save) — shared by `discover` and `login`. */
async function discoverAndSave(flags, store, repoDir, { makeDefault }) {
  let url = str(flags.url);
  let name = str(flags.profile) ? assertProfileName(flags.profile) : null;
  if (!url) {
    const existing = resolveProfileName(flags, store, repoDir);
    const profile = existing ? store.getProfile(existing) : null;
    if (profile) {
      url = profile.apiBase;
      name = name || existing;
    } else {
      url = str(process.env.AISHA_URL) || (await localDefaultUrl());
      if (!url) throw new UsageError("no --url given and no local stack preset found — pass --url <api base>");
    }
  }
  const profile = await discoverInstance(url);
  name = name || assertProfileName(profileNameFromUrl(profile.apiBase));
  const previous = store.getProfile(name);
  if (previous && previous.oidc.issuer !== profile.oidc.issuer) {
    store.deleteCredential(name);
    note(`! realm changed (${previous.oidc.issuer} → ${profile.oidc.issuer}) — old login dropped`);
  }
  store.saveProfile(name, profile, { makeDefault });
  return { name, profile };
}

function printDiscovery(name, profile) {
  const a = profile.appConfig;
  say(`profile   ${name}`);
  say(`api       ${profile.apiBase}`);
  say(`gateway   ${a.aisha_url}`);
  say(`mcp       ${a.mcp_url}`);
  say(`realm     ${profile.oidc.issuer}`);
  say(`device    ${profile.oidc.device_authorization_endpoint ? "supported" : "NOT offered by the realm"}`);
  if (a.web_url) say(`web       ${a.web_url}`);
}

function canOpenBrowser() {
  if (!process.stdout.isTTY) return false;
  if (process.platform === "darwin" || process.platform === "win32") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // printing the URL is enough
  }
}

async function cmdLogin(flags, store, repoDir) {
  const { name, profile } = await discoverAndSave(flags, store, repoDir, { makeDefault: flags.default === true });
  const clientId = str(flags["client-id"]) || DEFAULT_CLIENT_ID;
  const scope = [str(flags.scope) || DEFAULT_SCOPE, flags.offline === true ? "offline_access" : ""].filter(Boolean).join(" ");
  const device = await startDeviceAuthorization({ endpoint: profile.oidc.device_authorization_endpoint, clientId, scope });

  const target = device.verification_uri_complete || device.verification_uri;
  say(`Log in to ${profile.oidc.issuer}`);
  say(`  open:  ${target}`);
  say(`  code:  ${device.user_code}`);
  say(`  (expires in ${Math.round(device.expires_in / 60)} min)`);
  if (flags["no-open"] !== true && canOpenBrowser()) openBrowser(target);

  const tokens = await pollDeviceToken({ tokenEndpoint: profile.oidc.token_endpoint, clientId, device });
  const credential = toCredential(tokens, { issuer: profile.oidc.issuer, clientId });
  store.saveCredential(name, credential);
  say(`✓ logged in as ${credential.email || credential.username || credential.subject} — profile "${name}"`);
  // Keycloak drops a scope the client is not allowed to request instead of failing.
  if (flags.offline === true && !credential.scope.split(" ").includes("offline_access")) {
    note("! the realm did not grant offline_access to this client — the session ends with the realm's SSO idle/max timeout");
  }
  say(`  next: aisha-connect init --profile ${name}    (in the repository you work on)`);
  say(`        aisha-connect validate --profile ${name}`);
  return EXIT.ok;
}

async function freshCredential(name, profile, store) {
  return ensureFreshCredential({
    profile,
    credential: store.getCredential(name),
    persist: (c) => store.saveCredential(name, c),
    reload: () => store.getCredential(name),
  });
}

async function cmdToken(flags, store, repoDir) {
  const { name, profile } = requireProfile(flags, store, repoDir);
  const credential = await freshCredential(name, profile, store);
  const format = str(flags.format) || "raw";
  if (format === "header") say(JSON.stringify({ Authorization: `Bearer ${credential.access_token}` }));
  else if (format === "json") {
    say(JSON.stringify({ profile: name, access_token: credential.access_token, expires_at: new Date(credential.expires_at).toISOString(), issuer: credential.issuer }));
  } else if (format === "raw") say(credential.access_token);
  else throw new UsageError(`unknown --format "${format}" (raw|header|json)`);
  return EXIT.ok;
}

/** URLs every AISHA consumer in this repo already reads (dirigent config, Claude plugin, mint-pat). */
export function connectEnv(name, profile) {
  const a = profile.appConfig;
  const env = {
    AISHA_PROFILE: name,
    AISHA_URL: a.aisha_url,
    AISHA_API_BASE_URL: a.aisha_url,
    AISHA_POSTGREST_URL: a.aisha_url,
    AISHA_MCP_URL: a.mcp_url,
    AISHA_KEYCLOAK_URL: a.keycloak_url,
    AISHA_ANON_KEY: a.anon_key,
    AISHA_POSTGREST_ANON_KEY: a.anon_key,
  };
  if (a.n8n_trigger_url) env.AISHA_N8N_TRIGGER_URL = a.n8n_trigger_url;
  return env;
}

async function cmdEnv(flags, store, repoDir) {
  const { name, profile } = requireProfile(flags, store, repoDir);
  const env = connectEnv(name, profile);
  if (flags["with-token"] === true) env.AISHA_ACCESS_TOKEN = (await freshCredential(name, profile, store)).access_token;
  const shell = str(flags.shell) || "posix";
  for (const [k, v] of Object.entries(env)) {
    if (shell === "powershell") say(`$env:${k} = '${String(v).replace(/'/g, "''")}'`);
    else say(`export ${k}=${shellQuote(v, "linux")}`);
  }
  if (flags["with-token"] === true) note("# the access token is short-lived — prefer `aisha-connect exec -- …` for longer jobs");
  return EXIT.ok;
}

async function cmdExec(flags, store, repoDir) {
  if (!flags.passthrough.length) throw new UsageError("usage: aisha-connect exec [--profile <name>] -- <command> [args...]");
  const { name, profile } = requireProfile(flags, store, repoDir);
  const credential = await freshCredential(name, profile, store);
  const env = { ...process.env, ...connectEnv(name, profile), AISHA_ACCESS_TOKEN: credential.access_token };
  // AISHA_TOKEN is the slot for a long-lived personal access token (mcp_…) — never displace one.
  if (!process.env.AISHA_TOKEN) env.AISHA_TOKEN = credential.access_token;
  const [cmd, ...args] = flags.passthrough;
  return new Promise((resolveExit) => {
    const child = spawn(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
    child.on("error", (err) => {
      note(`✗ ${cmd}: ${err.message}`);
      resolveExit(EXIT.error);
    });
    child.on("exit", (code, signal) => resolveExit(code ?? (signal ? 128 : EXIT.error)));
  });
}

async function cmdInit(flags, store, repoDir) {
  const { name, profile } = requireProfile(flags, store, repoDir);
  if (!existsSync(repoDir)) throw new UsageError(`--repo ${repoDir} does not exist`);
  const file = writeDirigentLocal(repoDir, name, dirigentProfileFrom(name, profile));
  say(`✓ ${file} → active profile "${name}"`);
  const ignored = ensureGitignored(repoDir);
  if (ignored === "added") say(`✓ .gitignore now ignores ${DIRIGENT_LOCAL}`);
  if (ignored === "no-git") note(`! ${repoDir} is not a git work tree — make sure ${DIRIGENT_LOCAL} is never committed`);

  const mcpMode = str(flags.mcp) || "local";
  const auth = str(flags["mcp-auth"]) || (mcpMode === "project" ? "oauth" : "helper");
  if (mcpMode === "none") return EXIT.ok;
  const entry = mcpServerEntry({
    mcpUrl: profile.appConfig.mcp_url,
    auth,
    helperCommand: auth === "helper" ? headersHelperCommand(CLI_PATH, name) : undefined,
    clientId: str(flags["mcp-client-id"]) || DEFAULT_MCP_OAUTH_CLIENT_ID,
    callbackPort: Number(str(flags["mcp-callback-port"]) || DEFAULT_MCP_OAUTH_CALLBACK_PORT),
  });
  if (mcpMode === "project") {
    say(`✓ ${writeProjectMcpJson(repoDir, entry)} → aisha-knowledge (${auth})`);
  } else if (mcpMode === "local") {
    const r = registerWithClaude(repoDir, entry, { scope: "local" });
    if (r.status === "registered") say(`✓ Claude Code: aisha-knowledge registered (local scope, ${auth})`);
    else {
      note(r.status === "no-claude" ? "! Claude Code CLI not found — register the MCP server yourself:" : `! claude mcp add-json failed: ${r.detail}`);
      note(`  ${r.command}`);
    }
  } else throw new UsageError(`unknown --mcp "${mcpMode}" (local|project|none)`);
  if (auth === "helper" && !store.getCredential(name)) note(`! not logged in yet — run: aisha-connect login --profile ${name}`);
  return EXIT.ok;
}

async function cmdValidate(flags, store, repoDir) {
  const { name, profile } = requireProfile(flags, store, repoDir);
  const results = await runValidation({
    profileName: name,
    profile,
    credential: store.getCredential(name),
    persistCredential: (c) => store.saveCredential(name, c),
    reloadCredential: () => store.getCredential(name),
    repoDir: flags.repo !== undefined || existsSync(join(repoDir, DIRIGENT_LOCAL)) ? repoDir : null,
    checkMcpOAuth: flags["check-mcp-oauth"] === true,
  });
  const summary = summarize(results);
  if (flags.json === true) say(JSON.stringify({ profile: name, apiBase: profile.apiBase, ...summary, checks: results }, null, 2));
  else {
    const mark = { pass: "✓", fail: "✗", warn: "!", skip: "-" };
    say(`aisha-connect validate — profile "${name}" (${profile.apiBase})`);
    for (const r of results) say(`  ${mark[r.status]} ${r.id.padEnd(19)} ${r.detail}`);
    say(summary.ok ? `OK — ${summary.total} checks, ${summary.warned} warning(s)` : `FAILED — ${summary.failed} of ${summary.total} checks`);
  }
  return summary.ok ? EXIT.ok : EXIT.validation;
}

function cmdStatus(flags, store) {
  const data = store.readProfiles();
  const creds = store.readCredentials().profiles;
  const now = Date.now();
  const rows = Object.entries(data.profiles).map(([name, p]) => {
    const c = creds[name];
    return {
      name,
      default: data.defaultProfile === name,
      apiBase: p.apiBase,
      issuer: p.oidc.issuer,
      user: c ? c.email || c.username || c.subject : null,
      accessExpiresIn: c ? Math.round((c.expires_at - now) / 1000) : null,
      sessionExpiresIn: c?.refresh_expires_at ? Math.round((c.refresh_expires_at - now) / 1000) : null,
    };
  });
  if (flags.json === true) {
    say(JSON.stringify({ configDir: store.dir, profiles: rows }, null, 2));
    return EXIT.ok;
  }
  say(`config: ${store.dir}`);
  if (!rows.length) say("no profiles — run: aisha-connect login [--url <api base>]");
  for (const r of rows) {
    const login = !r.user
      ? "not logged in"
      : r.sessionExpiresIn !== null && r.sessionExpiresIn <= 0
        ? `${r.user} — session expired, log in again`
        : `${r.user}${r.sessionExpiresIn !== null ? ` (session ${Math.round(r.sessionExpiresIn / 60)} min left)` : ""}`;
    say(`${r.default ? "*" : " "} ${r.name.padEnd(20)} ${r.apiBase}  ${login}`);
  }
  return EXIT.ok;
}

async function cmdLogout(flags, store, repoDir) {
  const { name, profile } = requireProfile(flags, store, repoDir);
  const credential = store.getCredential(name);
  if (!credential) {
    say(`profile "${name}" is not logged in`);
    return EXIT.ok;
  }
  const r = await revokeRefreshToken({ revocationEndpoint: profile.oidc.revocation_endpoint, credential });
  store.deleteCredential(name);
  say(`✓ logged out of "${name}"${r.revoked ? " (session revoked)" : ` (local only: ${r.reason})`}`);
  return EXIT.ok;
}

async function main(argv) {
  const [command = "help", ...rest] = argv;
  const flags = parseArgs(rest);
  const repoDir = resolve(str(flags.repo) || process.cwd());
  const store = createStore();
  switch (command) {
    case "discover": {
      const { name, profile } = await discoverAndSave(flags, store, repoDir, { makeDefault: flags.default === true });
      printDiscovery(name, profile);
      return EXIT.ok;
    }
    case "login":
      return cmdLogin(flags, store, repoDir);
    case "token":
      return cmdToken(flags, store, repoDir);
    case "env":
      return cmdEnv(flags, store, repoDir);
    case "exec":
      return cmdExec(flags, store, repoDir);
    case "init":
      return cmdInit(flags, store, repoDir);
    case "validate":
      return cmdValidate(flags, store, repoDir);
    case "status":
      return cmdStatus(flags, store);
    case "logout":
      return cmdLogout(flags, store, repoDir);
    case "help":
    case "--help":
    case "-h":
      say(HELP);
      return EXIT.ok;
    default:
      throw new UsageError(`unknown command "${command}" — see: aisha-connect help`);
  }
}

// realpath: an `npm link`/global install starts us through a symlink.
function startedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(CLI_PATH);
  } catch {
    return false;
  }
}
const isEntry = startedDirectly();
if (isEntry) {
  // `aisha-connect env | head` closes the pipe early — that is not an error.
  process.stdout.on("error", (err) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      if (err instanceof LoginRequiredError) {
        note(`✗ ${err.message} — run: aisha-connect login`);
        process.exitCode = EXIT.login;
        return;
      }
      note(`✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = EXIT.error;
    });
}

export { main, parseArgs, resolveProfileName };
