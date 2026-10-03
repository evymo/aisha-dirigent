#!/usr/bin/env node
/**
 * public-snapshot.mjs — publish a HISTORY-FREE snapshot of this repository.
 *
 * Why an orphan commit and not a mirror: upstream history carries values that were valid at some
 * point (tokens, personal data in old seeds). The owner's decision (2026-10-01) is "no rotation,
 * public repository only from a snapshot without history". So every public preview is ONE commit
 * whose tree is the verified tree of a known upstream commit, and `git log` on the public side
 * shows previews only.
 *
 * The tool does four things, in order, and stops at the first failure:
 *   1. resolve the source tree (a revision, or the working tree through a temporary index),
 *   2. remove the paths listed in config/public-snapshot.exclude,
 *   3. CHECK the resulting tree — forbidden paths, private-key bodies, service_role tokens,
 *      Coolify API tokens, home-directory paths, public IPv4 addresses, free-mail addresses.
 *      The checks are not an allowlist of known findings: every pattern must be absent.
 *   4. create the orphan commit and, only with --push, force-push it to <remote>/<branch>
 *      (optionally deleting every other branch on that remote first) — after checking that the
 *      remote does not keep refs a forced push cannot remove.
 *
 * Usage:
 *   node scripts/release/public-snapshot.mjs [--root <repo>] [--source <rev>|worktree] [--label "<text>"]
 *        [--trailer "<Key: value>"]... [--gitlink <path>=<commit>]... [--out <dir>] [--dry-run]
 *        [--push <remote>] [--branch <name>] [--prune-remote-branches] [--accept-retained-refs]
 *
 * --root publishes another repository (a submodule, the SDK) through the same checks.
 * --gitlink points a submodule path at the commit of that submodule's own PUBLIC snapshot: a history-free
 * snapshot is a different commit than the one upstream records, and nobody outside could resolve that one.
 *
 * --push refuses a remote that keeps refs outside refs/heads/ (pull-request refs): a forced push cannot
 * remove them and they keep earlier history fetchable. --accept-retained-refs overrides that for a
 * PRIVATE staging repository only.
 *
 * Process documentation: docs/release/PUBLIC_PREVIEW.md
 * Tests: scripts/release/public-snapshot.test.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "../lib/cli-entry.mjs";
import { envWithoutGitLocation } from "../lib/git-worktree-health.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_EXCLUDE_FILE = "config/public-snapshot.exclude";

/**
 * Run git and return trimmed stdout. Throws on non-zero exit (the caller decides what that means).
 *
 * The repository is addressed by `cwd` ONLY. A git hook in a linked worktree exports GIT_DIR /
 * GIT_INDEX_FILE / GIT_WORK_TREE to every descendant and git prefers them over `cwd` — the class of
 * defect that has already rewritten this repository's shared config and index four times (see the gate
 * `git-v-testech-bez-prostredi`). So the inherited git location is stripped with the shared helper.
 */
export function git(root, args, { input, env } = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input,
    env: { ...envWithoutGitLocation(), ...env },
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  }).replace(/\n$/, "");
}

/** git that is ALLOWED to exit 1 (grep with no matches) — anything else still throws. */
function gitGrep(root, args) {
  try {
    return git(root, args);
  } catch (e) {
    if (e.status === 1) return "";
    throw e;
  }
}

// ── 1. source tree ──────────────────────────────────────────────────────────

/**
 * Resolve what is being published.
 *  - `rev`: the committed tree of that revision.
 *  - `worktree`: a temporary index built from the working tree (tracked + untracked, honouring
 *    .gitignore) so uncommitted documentation can ship; the base commit and the differing paths are
 *    recorded for the manifest — a snapshot must always say what it was cut from.
 */
export function resolveSourceTree(root, source) {
  if (source === "worktree") {
    const base = git(root, ["rev-parse", "HEAD"]);
    const indexFile = path.join(mkdtempSync(path.join(os.tmpdir(), "snapshot-index-")), "index");
    const env = { GIT_INDEX_FILE: indexFile };
    git(root, ["read-tree", "HEAD"], { env });
    git(root, ["add", "-A", "--", "."], { env });
    const tree = git(root, ["write-tree"], { env });
    const baseTree = git(root, ["rev-parse", `${base}^{tree}`]);
    const changed = tree === baseTree ? [] : git(root, ["diff", "--name-status", baseTree, tree]).split("\n").filter(Boolean);
    rmSync(path.dirname(indexFile), { recursive: true, force: true });
    return { tree, base, dirty: tree !== baseTree, changed, describe: `${base} + working tree` };
  }
  const base = git(root, ["rev-parse", `${source}^{commit}`]);
  const tree = git(root, ["rev-parse", `${base}^{tree}`]);
  return { tree, base, dirty: false, changed: [], describe: base };
}

// ── 2. exclusions ───────────────────────────────────────────────────────────

export function parseExcludes(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** gitignore-style pattern → RegExp over a root-relative path. Supports `**`, `*`, `?`, trailing `/`. */
export function patternToRegExp(pattern) {
  let p = pattern.replace(/^\//, "");
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      const next = p[i + 2];
      if (next === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // A pattern without a slash matches at any depth (gitignore semantics); with a slash it is anchored.
  // (`p` already has the leading and trailing slash stripped — the first version sliced with `-0`
  // and got an empty string, so every pattern matched at any depth; the test caught it.)
  const anchored = p.includes("/") || pattern.startsWith("/");
  const prefix = anchored ? "^" : "^(?:.*/)?";
  return new RegExp(`${prefix}${re}${dirOnly ? "(?:/.*)?" : ""}$`);
}

export function excludedPaths(paths, patterns) {
  const regs = patterns.map(patternToRegExp);
  return paths.filter((p) => regs.some((r) => r.test(p)));
}

/**
 * Build a new tree object = `tree` minus the excluded paths, with submodule pointers rewritten.
 *
 * `gitlinks` maps a submodule path to the commit it must point to in the PUBLIC tree. A history-free
 * snapshot of a submodule repository is a different commit than the one upstream records, so the
 * upstream pointer cannot be resolved by anyone outside; the public tree therefore points at the
 * submodule's own public snapshot commit. Only an existing submodule pointer can be rewritten — a path
 * that is a file or does not exist is an error, never a silent no-op.
 * Returns { tree, excluded, fileCount, gitlinks: [{ path, from, to }] }.
 */
export function buildPublishedTree(root, tree, patterns, gitlinks = {}) {
  const indexFile = path.join(mkdtempSync(path.join(os.tmpdir(), "snapshot-build-")), "index");
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    git(root, ["read-tree", tree], { env });
    const paths = git(root, ["ls-files", "--cached", "-z"], { env }).split("\0").filter(Boolean);
    const excluded = excludedPaths(paths, patterns);
    if (excluded.length) {
      git(root, ["update-index", "--force-remove", "-z", "--stdin"], { env, input: excluded.join("\0") + "\0" });
    }
    const rewritten = [];
    for (const [p, to] of Object.entries(gitlinks)) {
      if (!/^[0-9a-f]{40}$/.test(to)) throw new Error(`--gitlink ${p}: '${to}' is not a full commit id`);
      const entry = git(root, ["ls-files", "-s", "--", p], { env });
      const m = /^160000 ([0-9a-f]{40}) 0\t/.exec(entry);
      if (!m) throw new Error(`--gitlink ${p}: not a submodule pointer in the published tree`);
      git(root, ["update-index", "--cacheinfo", `160000,${to},${p}`], { env });
      rewritten.push({ path: p, from: m[1], to });
    }
    const published = git(root, ["write-tree"], { env });
    return { tree: published, excluded, fileCount: paths.length - excluded.length, gitlinks: rewritten };
  } finally {
    rmSync(path.dirname(indexFile), { recursive: true, force: true });
  }
}

// ── 3. checks ───────────────────────────────────────────────────────────────

/** Paths that must never be in a public tree — by NAME, before any content is read. */
export const FORBIDDEN_PATHS = [
  { id: "prod-users-seed", re: /(^|\/)00_prod_users[^/]*\.sql$/i },
  { id: "real-env-file", re: /(^|\/)\.env(\.[^/]*)?$/, unless: /\.example$/ },
  { id: "prod-env-backup", re: /(^|\/)\.env-prod-backup/ },
  { id: "private-key-file", re: /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i, unless: /(^|\/)config\/pki\/[^/]*-ca-bundle\.pem$|(^|\/)[^/]*\.pub\.pem$|OFL\.txt$/ },
  { id: "operator-roster", re: /(^|\/)config\/operators\.json$/ },
  { id: "tenant-sentinels", re: /(^|\/)config\/tenant\.json$/ },
];

/** Test fixtures are fiction by definition: a path or address inside a test exercises a parser, it does not point anywhere. */
const FIXTURE_FILE = /(^|\/)(e2e|__tests__)\/|(^|\/)src\/tests\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/** Line-oriented content patterns searched with `git grep -P` over the published tree. */
export const CONTENT_CHECKS = [
  { id: "service-role-jwt", pattern: "eyJyb2xlIjoic2VydmljZV9yb2xl[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{20,}" },
  { id: "coolify-api-token", pattern: "(?<![A-Za-z0-9])[0-9]+\\|[A-Za-z0-9]{40,}" },
  // Placeholder user names the repository's own `no-developer-account-codes` gate treats as fiction
  // are still reported here when they sit OUTSIDE a test: a published runbook must not say /Users/anyone.
  { id: "home-directory-path", pattern: "/Users/[A-Za-z][A-Za-z0-9._-]*/", skip: FIXTURE_FILE },
  {
    id: "freemail-address",
    pattern: "[A-Za-z0-9._%+-]+@(gmail|googlemail|seznam|centrum|yahoo|hotmail|outlook|icloud|protonmail)\\.(com|cz|net)",
    // + demo web templates, documentation examples and UI dictionaries (placeholders like your@email.com).
    skip: new RegExp(`${FIXTURE_FILE.source}|(^|/)(domains/templates|docs)/|(^|/)i18n/`),
  },
];

/**
 * IPv4 addresses that are NOT somebody's infrastructure:
 *   - private, loopback, link-local, CGNAT, multicast, broadcast (RFC 1918, 6598, …);
 *   - documentation and benchmark ranges (RFC 5737 TEST-NET-1/2/3, RFC 2544 198.18/15) — the ranges
 *     tests and docs are expected to use;
 *   - example.com's conventional address block (93.184.216.0/24), used by SSRF tests as "a public host";
 *   - "dummy" addresses whose every octet is ≤ 12 (1.2.3.4, 5.6.7.8, 7.7.7.7, 11.1.2.3 and the public
 *     resolvers 1.1.1.1, 8.8.8.8, 9.9.9.9) — never an operator's machine.
 * Everything else is reported. Real addresses of the maintainers' routers, phones, mail server and a
 * customer's VPN endpoint were found in test fixtures on 2026-10-03 by exactly this check.
 */
const RESERVED_IPV4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^192\.0\.[02]\./,
  /^198\.51\.100\./, /^203\.0\.113\./, /^198\.1[89]\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./,
  /^2[3-5]\d\./, /^255\./, /^93\.184\.216\./,
  // `a.b.0.0`: a network prefix (`192.0.0.0/24` in a blacklist) or a version string (`Chrome/120.0.0.0`), never a host.
  /^\d+\.\d+\.0\.0$/,
];

/** Boundary constants the subnet-derivation gates must name: the first address OUTSIDE a reserved range. */
const NETWORK_BOUNDARY_FIXTURES = new Set(["172.32.0.0", "100.1.1.1"]);

function isFictionalIPv4(ip) {
  if (RESERVED_IPV4.some((r) => r.test(ip))) return true;
  if (NETWORK_BOUNDARY_FIXTURES.has(ip)) return true;
  return ip.split(".").every((o) => Number(o) <= 12);
}

const SCAN_PATHSPEC = [":(exclude,glob)**/package-lock.json", ":(exclude,glob)**/*.lock", ":(exclude,glob)**/*.lockb"];

export function checkPublishedTree(root, tree) {
  const findings = [];
  const paths = git(root, ["ls-tree", "-r", "-z", "--name-only", tree]).split("\0").filter(Boolean);

  for (const p of paths) {
    for (const rule of FORBIDDEN_PATHS) {
      if (rule.re.test(p) && !(rule.unless && rule.unless.test(p))) findings.push({ check: rule.id, path: p });
    }
  }

  // Private-key BODIES: header line AND a base64 body line in the same file (a header alone is code
  // that parses PEM, a body alone is any base64 blob; both together is a key).
  const headerFiles = new Set(gitGrep(root, ["grep", "-I", "-l", "-E", "-e", "BEGIN (RSA |EC |OPENSSH |ENCRYPTED |DSA )?PRIVATE KEY", tree, "--", ...SCAN_PATHSPEC]).split("\n").filter(Boolean).map(stripTree));
  if (headerFiles.size) {
    const bodyFiles = gitGrep(root, ["grep", "-I", "-l", "-E", "-e", "^[A-Za-z0-9+/=]{64}$", tree, "--", ...SCAN_PATHSPEC]).split("\n").filter(Boolean).map(stripTree);
    for (const f of bodyFiles) if (headerFiles.has(f)) findings.push({ check: "private-key-body", path: f });
  }

  for (const c of CONTENT_CHECKS) {
    const hits = gitGrep(root, ["grep", "-I", "-n", "-P", "-e", c.pattern, tree, "--", ...SCAN_PATHSPEC]).split("\n").filter(Boolean);
    for (const h of hits) {
      const [file, line] = stripTree(h).split(":");
      if (c.skip && c.skip.test(file)) continue;
      findings.push({ check: c.id, path: file, line: Number(line) });
    }
  }

  const ipHits = gitGrep(root, ["grep", "-I", "-n", "-o", "-E", "-e", "(^|[^0-9.])([0-9]{1,3}\\.){3}[0-9]{1,3}([^0-9.]|$)", tree, "--", ...SCAN_PATHSPEC]).split("\n").filter(Boolean);
  for (const h of ipHits) {
    const m = /^(.*?):(\d+):(.*)$/.exec(stripTree(h));
    if (!m) continue;
    const ip = (m[3].match(/([0-9]{1,3}\.){3}[0-9]{1,3}/) || [""])[0];
    const octets = ip.split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => o > 255)) continue; // version strings like 1.2.3.400
    if (isFictionalIPv4(ip)) continue;
    findings.push({ check: "public-ipv4", path: m[1], line: Number(m[2]), value: ip });
  }

  const summary = {};
  for (const id of [...FORBIDDEN_PATHS.map((r) => r.id), "private-key-body", ...CONTENT_CHECKS.map((c) => c.id), "public-ipv4"]) summary[id] = 0;
  for (const f of findings) summary[f.check] = (summary[f.check] ?? 0) + 1;
  return { ok: findings.length === 0, findings, summary, fileCount: paths.length };

  function stripTree(line) {
    return line.startsWith(`${tree}:`) ? line.slice(tree.length + 1) : line;
  }
}

// ── 4. commit + push ────────────────────────────────────────────────────────

export function composeMessage({ label, source, published, checks, trailers }) {
  const lines = [
    label,
    "",
    `Source: ${source.describe}`,
    ...(source.dirty ? [`Working-tree changes against ${source.base}: ${source.changed.length} path(s)`] : []),
    `Tree: ${published.tree}`,
    `Files: ${published.fileCount}`,
    `Excluded from the snapshot: ${published.excluded.length ? published.excluded.join(", ") : "(none)"}`,
    ...(published.gitlinks?.length ? [`Submodule pointers rewritten to public snapshots: ${published.gitlinks.map((g) => `${g.path} ${g.from.slice(0, 12)} -> ${g.to}`).join(", ")}`] : []),
    `Checks: ${Object.entries(checks.summary).map(([k, v]) => `${k}=${v}`).join(" ")}`,
  ];
  if (trailers.length) lines.push("", ...trailers);
  return lines.join("\n") + "\n";
}

export function createOrphanCommit(root, tree, message) {
  return git(root, ["commit-tree", tree, "-F", "-"], { input: message });
}

export function remoteBranches(root, remote) {
  return git(root, ["ls-remote", "--heads", remote])
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t")[1].replace(/^refs\/heads\//, ""));
}

/**
 * Refs a forced push can NOT remove. A forge keeps `refs/pull/<n>/head` for every pull request ever
 * opened, forever, and anyone who can read the repository can fetch them — together with the whole
 * history they descend from. Measured 2026-10-03 on the previous public mirror: 389 such refs kept
 * 1 575 commits reachable (five roots, one of them real development history) after its `main` had
 * been squashed to a single commit.
 */
export function retainedRefs(root, remote) {
  return git(root, ["ls-remote", remote])
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t")[1])
    .filter((ref) => ref && ref !== "HEAD" && !ref.startsWith("refs/heads/") && !ref.endsWith("^{}"));
}

/**
 * `git push` with its output STREAMED to the caller. A push runs the repository's pre-push hook, and the
 * hook's output is the only place that says why a push was refused; captured output is dropped together
 * with the exception (measured 2026-10-03: 34 minutes of suite, then one line "failed to push some refs").
 */
function gitPush(root, args) {
  execFileSync("git", ["push", ...args], { cwd: root, env: envWithoutGitLocation(), stdio: ["ignore", "inherit", "inherit"] });
}

export function publish(root, { remote, commit, branch, pruneRemoteBranches }) {
  const pruned = [];
  if (pruneRemoteBranches) {
    const others = remoteBranches(root, remote).filter((b) => b !== branch);
    for (let i = 0; i < others.length; i += 50) {
      const chunk = others.slice(i, i + 50);
      gitPush(root, [remote, "--delete", ...chunk]);
      pruned.push(...chunk);
    }
  }
  gitPush(root, ["--force", remote, `${commit}:refs/heads/${branch}`]);
  return { pruned };
}

// ── orchestration ───────────────────────────────────────────────────────────

export function snapshot(root, opts) {
  const source = resolveSourceTree(root, opts.source ?? "HEAD");
  const excludeFile = path.join(root, opts.excludeFile ?? DEFAULT_EXCLUDE_FILE);
  const patterns = existsSync(excludeFile) ? parseExcludes(readFileSync(excludeFile, "utf8")) : [];
  const published = buildPublishedTree(root, source.tree, patterns, opts.gitlinks ?? {});
  const checks = checkPublishedTree(root, published.tree);
  const message = composeMessage({ label: opts.label ?? "public snapshot", source, published, checks, trailers: opts.trailers ?? [] });
  const result = { source, published, checks, message, commit: null, pushed: null, retained: [], refused: null };
  if (!checks.ok) return result;
  // Before the dry-run return: a plan that says "would push" to a remote the real run refuses is a lie.
  if (opts.push) {
    result.retained = retainedRefs(root, opts.push);
    if (result.retained.length && !opts.acceptRetainedRefs) {
      result.refused = `remote '${opts.push}' keeps ${result.retained.length} ref(s) outside refs/heads/ (e.g. ${result.retained[0]}) that a forced push cannot remove`;
      return result;
    }
  }
  if (opts.dryRun) return result;
  result.commit = createOrphanCommit(root, published.tree, message);
  if (opts.push) {
    result.pushed = { remote: opts.push, branch: opts.branch ?? "main", ...publish(root, { remote: opts.push, commit: result.commit, branch: opts.branch ?? "main", pruneRemoteBranches: !!opts.pruneRemoteBranches }) };
  }
  return result;
}

function parseArgs(argv) {
  const o = { trailers: [], gitlinks: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--source") o.source = next();
    else if (a === "--label") o.label = next();
    else if (a === "--trailer") o.trailers.push(next());
    else if (a === "--out") o.out = next();
    else if (a === "--root") o.root = next();
    else if (a === "--gitlink") {
      const [p, sha] = String(next()).split("=");
      if (!p || !sha) throw new Error("--gitlink expects <path>=<commit>");
      o.gitlinks[p] = sha;
    }
    else if (a === "--exclude-file") o.excludeFile = next();
    else if (a === "--push") o.push = next();
    else if (a === "--branch") o.branch = next();
    else if (a === "--prune-remote-branches") o.pruneRemoteBranches = true;
    else if (a === "--accept-retained-refs") o.acceptRetainedRefs = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*\n/, "").replace(/^ \* ?/gm, ""));
    return 0;
  }
  // --root publishes ANOTHER repository with the same checks (a submodule, the SDK); default is this one.
  const root = opts.root ? git(path.resolve(opts.root), ["rev-parse", "--show-toplevel"]) : git(HERE, ["rev-parse", "--show-toplevel"]);
  const r = snapshot(root, opts);
  const out = opts.out ? path.resolve(opts.out) : null;
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, "public-snapshot.json"), JSON.stringify(r, null, 2));
    writeFileSync(path.join(out, "public-snapshot.message.txt"), r.message);
  }
  console.log(`source   ${r.source.describe}${r.source.dirty ? ` (${r.source.changed.length} path(s) differ from ${r.source.base})` : ""}`);
  console.log(`tree     ${r.published.tree} (${r.published.fileCount} files)`);
  console.log(`excluded ${r.published.excluded.length ? r.published.excluded.join(", ") : "(none)"}`);
  for (const g of r.published.gitlinks ?? []) console.log(`gitlink  ${g.path} ${g.from.slice(0, 12)} -> ${g.to}`);
  console.log(`checks   ${Object.entries(r.checks.summary).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  if (!r.checks.ok) {
    for (const f of r.checks.findings.slice(0, 50)) console.error(`  ✗ ${f.check}: ${f.path}${f.line ? `:${f.line}` : ""}${f.value ? ` (${f.value})` : ""}`);
    if (r.checks.findings.length > 50) console.error(`  … ${r.checks.findings.length - 50} more`);
    console.error("STOP — the published tree carries data that must not be public. Nothing was committed or pushed.");
    return 2;
  }
  if (r.refused) {
    console.error(`STOP — ${r.refused}.`);
    console.error("  Those refs keep earlier history fetchable by anyone who can read the repository, so a repository");
    console.error("  that has them must not become public. Publish into a repository that never had them (delete and");
    console.error("  recreate it, or ask the forge to purge them). For a PRIVATE staging push add --accept-retained-refs.");
    return 3;
  }
  if (opts.dryRun) {
    console.log("dry-run  no commit created, nothing pushed");
    return 0;
  }
  if (r.retained.length) console.log(`WARNING  remote keeps ${r.retained.length} ref(s) outside refs/heads/ — this repository is NOT publishable as public`);
  console.log(`commit   ${r.commit}`);
  if (r.pushed) console.log(`pushed   ${r.pushed.remote}/${r.pushed.branch}${r.pushed.pruned.length ? ` (pruned ${r.pushed.pruned.length} branch(es))` : ""}`);
  else console.log("local    not pushed (add --push <remote> to publish)");
  return 0;
}

// isDirectRun compares the FILE (dev+ino), not the spelling of its path — a string comparison silently
// skips this block in a worktree whose path has a symlink or a non-ASCII name (gate strazce-vstupu-porovnava-soubor).
if (isDirectRun(import.meta.url)) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(`public-snapshot: ${e.message}`);
    process.exit(1);
  }
}
