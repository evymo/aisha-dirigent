#!/usr/bin/env node
/**
 * aisha-deps-update.mjs — self-hosted dependency updater (Dependabot replacement).
 *
 * Replaces .github/dependabot.yml (its hand-maintained directory list drifted —
 * 11 packages, 6 services, the extension and the plugin-exec shim were never
 * covered).
 *
 * Mirrors the aisha-packages-publish.mjs etalon: zero-dep Node ESM, DRY_RUN /
 * APPLY env switches plumbed from workflow_dispatch booleans, GitHub REST API
 * (repository = GITHUB_REPOSITORY, no default), audit beacon via
 * log_integration_action, exit codes 0 (ok) / 1 (failure) / 2 (misconfiguration).
 *
 * What it does, per update target (root workspace + every standalone
 * package-lock.json root, discovered — not hand-listed):
 *   1. `npm outdated --json`  → candidate set (minor+patch only; majors are
 *      NEVER automated, mirroring the dependabot ignore rule)
 *   2. `npm audit --json`     → security findings (>= policy.auditLevel) get
 *      a priority group — the replacement for GitHub's out-of-band security
 *      updates, and the mechanism that finally makes the npm-audit CI jobs
 *      gateable (update PRs resolve what those jobs only warn about)
 *   3. group by policy (production/development), respecting maxOpenPrs
 *   4. DRY RUN (default): print the plan, exit 0
 *   5. APPLY=1: per group — branch off baseBranch, `npm install pkg@<range>`
 *      + lockfile regen, commit, push, open an idempotent pull request
 *      (existing open PR with the same head branch → updated, not duplicated)
 *
 * Internal @aisha/* / @evymo/* packages are never bumped here — they version
 * through aisha-packages-publish. The updater instead REPORTS consumers that
 * resolve an older published version than the workspace source (the private
 * registry chicken-and-egg documented at supply-chain.yml npm-audit-services)
 * so the sequence is: merge package bump → publish → re-run updater.
 *
 * Usage:
 *   node scripts/aisha-deps-update.mjs                 # dry-run plan
 *   APPLY=1 node scripts/aisha-deps-update.mjs         # open PRs
 *   TARGET_FILTER=mobile-app node scripts/aisha-deps-update.mjs
 *
 * Env:
 *   APPLY=1            actually branch/commit/push/PR (default: dry-run)
 *   TARGET_FILTER      substring filter on target paths
 *   GITHUB_REPOSITORY  owner/repo — required for APPLY (set by Actions; no default)
 *   GITHUB_TOKEN       required for APPLY (PR creation; GH_TOKEN also accepted)
 *   GITHUB_API_URL     REST base — required for APPLY (set by Actions; locally e.g.
 *                      https://api.github.com, GitHub Enterprise https://<host>/api/v3)
 *   AISHA_GATEWAY_URL + POSTGREST_SERVICE_TOKEN  optional audit beacon
 *
 * @module
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./lib/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const POLICY_PATH = path.join(ROOT, "config", "deps-policy.json");

const APPLY = process.env.APPLY === "1";
const TARGET_FILTER = process.env.TARGET_FILTER || "";

/**
 * Kam se PR zakládají — jen z prostředí, NIC se nedosazuje (ani adresa API:
 * dosazená adresa by u GitHub Enterprise tiše mířila jinam —
 * zadny-fallback-nad-identitou). Repo bez deklarace by byl odhad, a odhad tady
 * znamená PR do cizího repa. Dry-run API nepotřebuje; APPLY ověří všechno.
 */
export function cilZProstredi(env = process.env) {
  return {
    api: (env.GITHUB_API_URL || "").replace(/\/+$/, ""),
    repo: env.GITHUB_REPOSITORY || "",
    token: env.GITHUB_TOKEN || env.GH_TOKEN || "",
  };
}

// ── logging (mirrors aisha-packages-publish) ────────────────────────────────
const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
function log(level, msg) {
  const color = { info: C.cyan, ok: C.green, warn: C.yellow, error: C.red }[level] ?? "";
  console.log(`${color}[deps-update:${level}]${C.reset} ${msg}`);
}

function fail(code, msg) {
  log("error", msg);
  process.exit(code);
}

// ── policy ──────────────────────────────────────────────────────────────────
// Read lazily (main), so the PR helpers below are importable by tests.
let policy = {};
let EXCLUDES = [];
let INTERNAL_SCOPES = ["@aisha", "@evymo"];
function loadPolicy() {
  if (!existsSync(POLICY_PATH)) fail(2, `policy file missing: ${POLICY_PATH}`);
  policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
  EXCLUDES = policy.targets?.excludePathPatterns ?? [];
  INTERNAL_SCOPES = policy.internalScopes ?? ["@aisha", "@evymo"];
}

// ── target discovery: root + standalone lockfile roots ─────────────────────
function discoverTargets() {
  const out = execFileSync(
    "find", [".", "-name", "package-lock.json", "-not", "-path", "*/node_modules/*"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const targets = out
    .split("\n")
    .filter(Boolean)
    .map((p) => path.dirname(p.replace(/^\.\//, "")))
    .filter((dir) => !EXCLUDES.some((pat) => (dir + "/").includes(pat)))
    .sort();
  // root first ("." sorts first anyway), then the standalone roots
  return targets.filter((t) => !TARGET_FILTER || t.includes(TARGET_FILTER) || (t === "." && TARGET_FILTER === "root"));
}

// ── npm helpers ─────────────────────────────────────────────────────────────
function npmJson(args, cwd) {
  // npm exits non-zero when outdated/audit find anything — capture stdout anyway.
  try {
    return JSON.parse(execFileSync("npm", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    const stdout = err?.stdout?.toString?.() ?? "";
    if (!stdout.trim()) return null;
    try { return JSON.parse(stdout); } catch { return null; }
  }
}

function semverParts(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

function updateType(current, latest) {
  const c = semverParts(current);
  const l = semverParts(latest);
  if (!c || !l) return "unknown";
  if (l.major !== c.major) return "major";
  if (l.minor !== c.minor) return "minor";
  return "patch";
}

// ── plan computation ────────────────────────────────────────────────────────
function planTarget(dir) {
  const abs = path.join(ROOT, dir);
  const pkg = JSON.parse(readFileSync(path.join(abs, "package.json"), "utf8"));
  const devDeps = new Set(Object.keys(pkg.devDependencies ?? {}));

  const outdated = npmJson(["outdated", "--json"], abs) ?? {};
  const audit = npmJson(["audit", "--json", "--audit-level", policy.security?.auditLevel ?? "high"], abs);
  const vulnerable = new Set(Object.keys(audit?.vulnerabilities ?? {}));

  const updates = [];
  const internalDrift = [];
  for (const [name, info] of Object.entries(outdated)) {
    const entry = Array.isArray(info) ? info[0] : info;
    const { current, wanted, latest } = entry;
    if (!current) continue; // not installed (peer-only etc.)
    if (INTERNAL_SCOPES.some((s) => name.startsWith(s + "/"))) {
      // Internal packages version through aisha-packages-publish — report only.
      internalDrift.push({ name, current, latest });
      continue;
    }
    // minor+patch only; `wanted` respects the declared range, `latest` may be
    // a major. Prefer the highest non-major.
    const candidate = updateType(current, latest) !== "major" ? latest : wanted;
    if (!candidate || candidate === current) continue;
    const type = updateType(current, candidate);
    if (!(policy.allowedUpdateTypes ?? ["minor", "patch"]).includes(type)) continue;
    updates.push({
      name,
      current,
      target: candidate,
      type,
      group: vulnerable.has(name) ? "security" : devDeps.has(name) ? "development" : "production",
    });
  }
  return { dir, updates, internalDrift, auditTotals: audit?.metadata?.vulnerabilities ?? null };
}

// ── GitHub REST API (zero-dep fetch) ──────────────────────────────────────
/**
 * One REST call. Returns `{ status, json }`; a non-JSON body is `json: null`
 * (logged), never a throw — the caller decides what a status means.
 */
export async function githubApi({ api, token, f = fetch }, method, endpoint, body) {
  const res = await f(`${api}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    console.warn(`[deps-update:warn] non-JSON response from ${endpoint} (HTTP ${res.status})`);
  }
  return { status: res.status, json };
}

/**
 * Idempotent PR: an open PR whose head is `branch` gets its body refreshed;
 * otherwise a new PR is opened. Returns `{ pr, updated? }` or `{ pr: null, error }`.
 */
export async function upsertPullRequest(cil, { branch, base, title, body }) {
  const [owner] = cil.repo.split("/");
  const q = new URLSearchParams({ state: "open", head: `${owner}:${branch}`, per_page: "100" });
  const existing = await githubApi(cil, "GET", `/repos/${cil.repo}/pulls?${q}`);
  if (existing.status >= 300 || !Array.isArray(existing.json)) {
    return { pr: null, error: `PR lookup failed (${existing.status})` };
  }
  const open = existing.json.find((p) => p?.head?.ref === branch);
  if (open) {
    const upd = await githubApi(cil, "PATCH", `/repos/${cil.repo}/pulls/${open.number}`, { body });
    if (upd.status >= 300) return { pr: null, error: `PR #${open.number} update failed (${upd.status})` };
    return { pr: open.number, updated: true };
  }
  const created = await githubApi(cil, "POST", `/repos/${cil.repo}/pulls`, { title, head: branch, base, body });
  if (created.status >= 300 || !created.json?.number) {
    return { pr: null, error: `PR creation failed (${created.status}): ${JSON.stringify(created.json)?.slice(0, 200)}` };
  }
  return { pr: created.json.number };
}

// ── apply: branch → install → commit → push → PR ───────────────────────────
// execFileSync with argument ARRAYS only — no shell, no interpolation, so a
// hostile package name/version from registry metadata cannot inject commands.
function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd: cwd ?? ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** npm package names/versions are tightly constrained — reject anything else
 *  BEFORE it reaches a process invocation (defense in depth on top of the
 *  no-shell exec). */
function assertSafeSpec(name, version) {
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) {
    throw new Error(`unsafe package name from registry metadata: ${JSON.stringify(name)}`);
  }
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) {
    throw new Error(`unsafe version for ${name}: ${JSON.stringify(version)}`);
  }
}

async function applyGroup(cil, target, group, items) {
  const slug = `${target.dir === "." ? "root" : target.dir.replace(/[^a-z0-9]+/gi, "-")}-${group}`;
  const branch = `${policy.branchPrefix ?? "deps/"}${slug}`;
  const base = policy.baseBranch ?? "main";
  const abs = path.join(ROOT, target.dir);

  log("info", `APPLY ${branch}: ${items.length} update(s)`);
  run("git", ["fetch", "origin", base, "--quiet"]);
  run("git", ["checkout", "-B", branch, `origin/${base}`]);
  try {
    for (const u of items) {
      assertSafeSpec(u.name, u.target);
      // npm rewrites the manifest range and the lockfile; --ignore-scripts
      // blocks install-script supply-chain execution during the bump itself.
      run("npm", ["install", `${u.name}@${u.target}`, "--ignore-scripts", "--no-audit", "--no-fund"], abs);
    }
    const manifests = target.dir === "."
      ? ["package.json", "package-lock.json"]
      : [`${target.dir}/package.json`, `${target.dir}/package-lock.json`];
    run("git", ["add", ...manifests]);
    const title = `chore(deps): ${group} updates for ${target.dir === "." ? "root workspace" : target.dir} (${items.length})`;
    const lines = items.map((u) => `- ${u.name}: ${u.current} → ${u.target} (${u.type}${u.group === "security" ? ", security" : ""})`);
    // Author = the git identity of the run (github-actions[bot] in CI) — no
    // address of any particular instance is baked in.
    run("git", ["commit", "-m", title, "-m", lines.join("\n")]);
    run("git", ["push", "-f", "origin", branch]);

    const body = [
      `Automated dependency updates (${group}) for \`${target.dir}\`.`,
      "",
      ...lines,
      "",
      "Policy: config/deps-policy.json (minor+patch only; majors are bespoke PRs).",
      "Runbook: docs/security/DEPS_UPDATE_RUNBOOK.md",
    ].join("\n");
    const r = await upsertPullRequest(cil, { branch, base, title, body });
    if (r.error) {
      log("error", r.error);
      return { branch, pr: null, error: true };
    }
    log("ok", `PR #${r.pr} ${r.updated ? "updated" : "opened"} (${branch})`);
    return { branch, pr: r.pr, updated: r.updated };
  } finally {
    run("git", ["checkout", "-"]);
  }
}

// ── audit beacon (soft-fail, mirrors packages-publish) ──────────────────────
async function beacon(action, detail, status) {
  const gw = (process.env.AISHA_GATEWAY_URL || "").replace(/\/+$/, "");
  const tok = process.env.POSTGREST_SERVICE_TOKEN || "";
  if (!gw || !tok) return;
  try {
    await fetch(`${gw}/rest/v1/rpc/log_integration_action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: tok, Authorization: `Bearer ${tok}` },
      body: JSON.stringify({
        p_service_name: "github",
        p_action: action,
        p_action_detail: detail,
        p_status: status,
        p_duration_ms: 0,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn(`[deps-update:warn] audit beacon unreachable (soft-fail): ${err?.message ?? err}`);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  loadPolicy();
  const cil = cilZProstredi();
  const targets = discoverTargets();
  if (targets.length === 0) fail(2, "no update targets discovered");
  log("info", `${targets.length} target(s): ${targets.join(", ")}`);
  if (APPLY && !cil.token) fail(2, "APPLY=1 requires GITHUB_TOKEN (or GH_TOKEN)");
  if (APPLY && !cil.api) fail(2, "APPLY=1 requires GITHUB_API_URL (set by Actions; locally e.g. https://api.github.com)");
  if (APPLY && !/^[^/\s]+\/[^/\s]+$/.test(cil.repo)) fail(2, "APPLY=1 requires GITHUB_REPOSITORY=<owner>/<repo> — no repository is assumed");

  const plans = [];
  for (const dir of targets) {
    log("info", `scanning ${dir} …`);
    try {
      plans.push(planTarget(dir));
    } catch (err) {
      log("warn", `target ${dir} failed to scan: ${err.message}`);
    }
  }

  let totalUpdates = 0;
  const prResults = [];
  for (const plan of plans) {
    const byGroup = new Map();
    for (const u of plan.updates) {
      if (!byGroup.has(u.group)) byGroup.set(u.group, []);
      byGroup.get(u.group).push(u);
    }
    if (plan.updates.length === 0 && plan.internalDrift.length === 0) {
      log("ok", `${plan.dir}: up to date`);
      continue;
    }
    for (const [group, items] of byGroup) {
      totalUpdates += items.length;
      console.log(`\n— ${plan.dir} [${group}] —`);
      for (const u of items) console.log(`  ${u.name}: ${u.current} → ${u.target} (${u.type})`);
      if (APPLY) {
        if (prResults.filter((r) => r.pr).length >= (policy.maxOpenPrs ?? 10)) {
          log("warn", `maxOpenPrs (${policy.maxOpenPrs}) reached — remaining groups deferred to the next sweep`);
          break;
        }
        prResults.push(await applyGroup(cil, plan, group, items));
      }
    }
    for (const d of plan.internalDrift) {
      log("warn", `${plan.dir}: internal ${d.name} resolves ${d.current} but ${d.latest} is published — `
        + "bump flows through aisha-packages-publish (merge package bump → publish → re-run)");
    }
  }

  console.log("");
  log(APPLY ? "ok" : "info",
    APPLY
      ? `done: ${prResults.filter((r) => r.pr).length} PR(s), ${totalUpdates} update(s)`
      : `DRY RUN: ${totalUpdates} update(s) across ${plans.length} target(s) — set APPLY=1 to open PRs`);
  await beacon("deps_update_sweep", {
    mode: APPLY ? "apply" : "dry-run",
    targets: plans.length,
    updates: totalUpdates,
    prs: prResults.filter((r) => r.pr).map((r) => r.pr),
  }, prResults.some((r) => r.error) ? "error" : "success");
  if (prResults.some((r) => r.error)) process.exit(1);
}

if (isDirectRun(import.meta.url)) {
  main().catch((err) => fail(1, err.stack || String(err)));
}
