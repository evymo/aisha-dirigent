/**
 * @module lib
 * Infrastructure helpers for the AISHA Dirigent Claude app MCP server.
 *
 * Pure I/O boundary: workspace resolution, safe file reads, child-process
 * execution, and local HTTP probing. No protocol or business logic here
 * (Separation of Concerns — see CLAUDE.md ruleset).
 *
 * IMPORTANT: nothing in this module may write to stdout. In an MCP stdio
 * server, stdout is the JSON-RPC channel. All diagnostics go to stderr.
 */

import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

/**
 * Resolve the AISHA workspace root.
 *
 * Resolution order (most explicit wins):
 *   1. AISHA_WORKSPACE env var          — set by the MCPB manifest user_config
 *   2. first CLI argument               — `node index.mjs /path/to/repo`
 *   3. CLAUDE_PROJECT_DIR env var       — Claude Code plugin runtime
 *   4. process.cwd()                    — fallback
 *
 * @returns {string} absolute path to the workspace root
 */
export function resolveWorkspace() {
  const candidate =
    process.env.AISHA_WORKSPACE ||
    process.argv[2] ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd();
  return path.resolve(candidate.replace(/^~(?=$|\/)/, os.homedir()));
}

/**
 * Write a diagnostic line to stderr (never stdout).
 * @param {string} msg
 */
export function logErr(msg) {
  process.stderr.write(`[aisha-dirigent-mcp] ${msg}\n`);
}

/**
 * Resolve a path relative to the workspace, guarding against traversal escapes.
 * @param {string} root  workspace root
 * @param {string} rel   relative path
 * @returns {string} absolute path inside root
 */
export function safeJoin(root, rel) {
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return full;
}

/**
 * Read a UTF-8 text file relative to the workspace. Returns null if missing.
 * @param {string} root
 * @param {string} rel
 * @returns {string|null}
 */
export function readText(root, rel) {
  try {
    const full = safeJoin(root, rel);
    if (!existsSync(full)) return null;
    return readFileSync(full, "utf-8");
  } catch (err) {
    logErr(`readText(${rel}) failed: ${err?.message || err}`);
    return null;
  }
}

/**
 * Read + parse a JSON file relative to the workspace. Returns null on miss/parse error.
 * @param {string} root
 * @param {string} rel
 * @returns {unknown|null}
 */
export function readJson(root, rel) {
  const raw = readText(root, rel);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    logErr(`readJson(${rel}) parse failed: ${err?.message || err}`);
    return null;
  }
}

/**
 * Does a path exist relative to the workspace?
 * @param {string} root
 * @param {string} rel
 * @returns {boolean}
 */
export function exists(root, rel) {
  try {
    return existsSync(safeJoin(root, rel));
  } catch {
    return false;
  }
}

/**
 * mtime (ISO string) of a workspace path, or null.
 * @param {string} root
 * @param {string} rel
 * @returns {string|null}
 */
export function mtimeOf(root, rel) {
  try {
    return statSync(safeJoin(root, rel)).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Run a command in the workspace with a hard timeout. Never throws — returns a
 * structured result so tool handlers stay total.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, timeoutMs?: number, env?: Record<string,string> }} [opts]
 * @returns {Promise<{ ok: boolean, code: number, stdout: string, stderr: string }>}
 */
export async function run(cmd, args, opts = {}) {
  const { cwd, timeoutMs = 20_000, env } = opts;
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: env ? { ...process.env, ...env } : process.env,
      windowsHide: true,
    });
    return { ok: true, code: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (err) {
    return {
      ok: false,
      code: typeof err?.code === "number" ? err.code : 1,
      stdout: String(err?.stdout || ""),
      stderr: String(err?.stderr || err?.message || err),
    };
  }
}

/**
 * Probe a local HTTP JSON endpoint with a short timeout. Returns null on any failure.
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown|null>}
 */
export async function probeJson(url, timeoutMs = 2_500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Is a binary available on PATH?
 * @param {string} bin
 * @returns {Promise<boolean>}
 */
export async function hasBin(bin) {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = await run(probe, [bin], { timeoutMs: 4_000 });
  return r.ok && r.stdout.trim().length > 0;
}

/**
 * Write a UTF-8 file relative to the workspace, creating parent dirs.
 * Used by the composition tools to author .claude/* artifacts.
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 * @param {{ executable?: boolean }} [opts]
 * @returns {string} absolute path written
 */
export function writeFile(root, rel, content, opts = {}) {
  const full = safeJoin(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
  if (opts.executable) {
    try {
      chmodSync(full, 0o755);
    } catch (err) {
      logErr(`chmod(${rel}) failed: ${err?.message || err}`);
    }
  }
  return full;
}

/**
 * Deep-merge an AISHA-generated `.claude/settings.json` patch into the existing
 * file content, preserving every user-owned key and only refreshing the entries
 * AISHA owns (marked `_aisha.managed === true`).
 *
 * SoT: scripts/ide-adapters/multi-file.mjs::mergeSettingsJson (+ mergeHookEvent).
 * We intentionally DUPLICATE the minimal deep-merge here instead of importing it:
 * this MCP server is zero-dependency and is packaged standalone into the .mcpb
 * bundle (which ships only `server/` — scripts/ide-adapters is NOT bundled), so a
 * relative import outside the server dir would crash the server when installed
 * outside the repo. Keep this in lock-step with the SoT.
 *
 * Why this matters here: the previous implementation did `JSON.parse(raw || "{}")`
 * and re-serialized, so a malformed / comment-bearing settings.json parsed to `{}`
 * and silently dropped every user key. This merge fails loud on bad existing JSON
 * (callers should refuse rather than clobber) and otherwise never loses user data.
 *
 * @param {string} existingJson  Current file content (or "" if the file is missing).
 * @param {string} generatedJson The AISHA patch to merge in.
 * @returns {string}             Merged JSON serialized with 2-space indent + trailing newline.
 * @throws if either input is non-empty but not valid JSON.
 */
export function mergeSettingsJson(existingJson, generatedJson) {
  let existing;
  let generated;
  try {
    existing = existingJson.trim() ? JSON.parse(existingJson) : {};
  } catch (e) {
    throw new Error(`mergeSettingsJson: existing JSON invalid: ${e.message}`);
  }
  try {
    generated = JSON.parse(generatedJson);
  } catch (e) {
    throw new Error(`mergeSettingsJson: generated JSON invalid: ${e.message}`);
  }

  const merged = { ...existing };

  // permissions: union arrays (de-duped).
  if (generated.permissions) {
    merged.permissions = merged.permissions || {};
    for (const key of ["allow", "deny"]) {
      const existingArr = Array.isArray(merged.permissions[key]) ? merged.permissions[key] : [];
      const generatedArr = Array.isArray(generated.permissions[key]) ? generated.permissions[key] : [];
      merged.permissions[key] = [...new Set([...existingArr, ...generatedArr])];
    }
  }

  // hooks: per-event, replace AISHA-managed entries, keep user entries.
  if (generated.hooks) {
    merged.hooks = merged.hooks || {};
    for (const eventName of Object.keys(generated.hooks)) {
      const existingEvent = Array.isArray(merged.hooks[eventName]) ? merged.hooks[eventName] : [];
      const generatedEvent = Array.isArray(generated.hooks[eventName]) ? generated.hooks[eventName] : [];
      merged.hooks[eventName] = mergeHookEvent(existingEvent, generatedEvent);
    }
  }

  // statusLine: replace only if generated declares ownership (or none exists yet).
  if (generated.statusLine) {
    if (generated.statusLine._aisha?.managed === true || !merged.statusLine) {
      merged.statusLine = generated.statusLine;
    }
  }

  // _aisha_managed: full replace (it's our metadata block).
  if (generated._aisha_managed) {
    merged._aisha_managed = generated._aisha_managed;
  }

  return JSON.stringify(merged, null, 2) + "\n";
}

/**
 * Merge a single hook event's `hooks[]` array: drop existing entries AISHA owns
 * (`_aisha.managed === true`), then concat user-kept entries + generated entries.
 * Mirrors mergeHookEvent() in the SoT (scripts/ide-adapters/multi-file.mjs).
 * @param {Array} existingEvent
 * @param {Array} generatedEvent
 * @returns {Array}
 */
function mergeHookEvent(existingEvent, generatedEvent) {
  /** @type {Map<string, {existing: Array, generated: Array}>} */
  const byMatcher = new Map();

  for (const entry of existingEvent) {
    const matcher = entry.matcher || "";
    if (!byMatcher.has(matcher)) byMatcher.set(matcher, { existing: [], generated: [] });
    byMatcher.get(matcher).existing = Array.isArray(entry.hooks) ? entry.hooks : [];
  }
  for (const entry of generatedEvent) {
    const matcher = entry.matcher || "";
    if (!byMatcher.has(matcher)) byMatcher.set(matcher, { existing: [], generated: [] });
    byMatcher.get(matcher).generated = Array.isArray(entry.hooks) ? entry.hooks : [];
  }

  /** @type {Array} */
  const merged = [];
  for (const [matcher, { existing, generated }] of byMatcher) {
    const existingKept = existing.filter((h) => h?._aisha?.managed !== true);
    const combined = [...existingKept, ...generated];
    if (combined.length > 0) {
      merged.push(matcher ? { matcher, hooks: combined } : { hooks: combined });
    }
  }
  return merged;
}
