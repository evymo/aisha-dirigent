#!/usr/bin/env node
/**
 * placeholder-scan.mjs — fail-loud if a RESOLVED deploy env carries a
 * placeholder / example value.
 *
 * Why this exists (2026-06-30 prod cold-start --wipe incident): when operator
 * TLDs were absent, scripts/lib/derive-domains.mjs silently fell back to
 * config/profiles/*.json.example and only WARNed to stderr. The resolved
 * topology carried `REGISTRY_PROXY=cache.aisha.example.com/`, which prefixes
 * EVERY image ref — so 100% of image pulls failed and the wiped stack never
 * redeployed. No doctor/gate inspected the resolved VALUES; env checks were
 * presence/shape only, and `docker compose config` treats an example hostname
 * as a syntactically valid image ref.
 *
 * This scanner closes that hole DYNAMICALLY:
 *   - the placeholder corpus is internet STANDARDS (RFC2606 example.{com,net,org}
 *     / .test, common placeholder words) AUGMENTED at runtime with hostname
 *     literals harvested from the repo's tracked *.example files — never a
 *     maintained allow-list of our own infra values;
 *   - it operates on the ACTUAL resolved artifact (.env.coolify or
 *     `derive-domains --shell`), every KEY=VALUE, not a fixed key subset;
 *   - it excludes the RFC6761 sentinels we deliberately ship (*.invalid /
 *     *.local / gate.test).
 *
 * Library use:  import { scanEnv, isPlaceholder } from "./placeholder-scan.mjs"
 * CLI use:      node scripts/lib/placeholder-scan.mjs [env-file]   # or pipe stdin
 *               exit 0 = clean, exit 1 = placeholder value(s) found
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { isDirectRun } from "./cli-entry.mjs";

/** Repo root, derived from THIS file — the harvest must not depend on cwd. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GIT_BIN = process.env.GIT_BIN || "git";

// RFC2606 / RFC6761 reserved domains + common placeholder words. STANDARDS,
// not an allow-list of our infra. Augmented at runtime from *.example files.
const PLACEHOLDER_PATTERNS = [
  /\bexample\.(com|net|org)\b/i, // RFC2606 reserved second-level
  /\.(example|test)(\b|[:/]|$)/i, // RFC2606 reserved TLD suffix (.example, .test)
  /\b(placeholder|change[-_]?me|your[-_]?domain|replace[-_]?me|todo|fixme|xxxx+)\b/i,
  // Vendor-neutral filler orgs, matched ONLY as a whole domain LABEL (start-or-dot
  // … label … dot). `mesh.acme.internal` and `acme.internal` are placeholders we
  // actually ship (config/fork-instance-inputs.env.example:31) and which no other
  // pattern rejects — they carry no reserved TLD. Matching the bare WORD instead
  // would be wrong: `acme` is also the Let's Encrypt protocol, present 14× in real
  // compose/scripts (ACME_EMAIL, the `letsencrypt` acme resolver,
  // acme-staging-v02.api.letsencrypt.org) — none of which is a label match.
  /(^|\.)(acme|contoso|mycompany|yourcompany|myorg|yourorg|foobar)\./i,
];

// Intentional non-routable sentinels we ship on purpose (RFC6761) — NOT
// placeholders. *.invalid (apex-redirect-disabled.invalid, live-disabled.invalid),
// *.local (local-dev), gate.test (gate fixtures).
const SENTINEL_PATTERNS = [
  /\.invalid(\b|[:/]|$)/i,
  /\.local(\b|[:/]|$)/i,
  /\bgate\.test\b/i,
];

// Secret-named keys are skipped — their values are random and may incidentally
// match a word pattern; placeholders only matter for hostnames/registries/URLs.
const SECRET_KEY = /(PASSWORD|SECRET|TOKEN|_KEY\b|KEY_|MNEMONIC|PRIVATE|CREDENTIAL)/i;

/** Corpus state after the last deriveExtraTokens(): ok | no-git | no-metadata | broken */
export let CORPUS_STATUS = "unknown";
export let CORPUS_DETAIL = "";

/**
 * Distinguish the LEGITIMATE degradation (no git binary, or a source tree with no
 * git metadata — a tarball export) from the ILLEGITIMATE one (git is present, the
 * repo is present, and git errored anyway). The first may degrade loudly; the
 * second must refuse, because it means the guard silently lost its corpus.
 */
function probeGit() {
  let version = "";
  try {
    version = execFileSync(GIT_BIN, ["--version"], { encoding: "utf8", cwd: ROOT }).trim();
  } catch (e) {
    return { status: "no-git", detail: `git binary not runnable (${GIT_BIN}): ${e.message}` };
  }
  const m = version.match(/(\d+)\.(\d+)\./);
  const major = m ? Number(m[1]) : 0;
  const minor = m ? Number(m[2]) : 0;
  // extensions.worktreeConfig — which this repo sets — needs git >= 2.20.
  const tooOld = major < 2 || (major === 2 && minor < 20);
  try {
    execFileSync(GIT_BIN, ["rev-parse", "--git-dir"], {
      encoding: "utf8",
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const msg = String(e.stderr || e.message || "");
    if (/not a git repository/i.test(msg)) {
      return { status: "no-metadata", detail: `no git metadata under ${ROOT}` };
    }
    return {
      status: "broken",
      detail:
        `${GIT_BIN} (${version}) failed inside ${ROOT}: ${msg.trim()}` +
        (tooOld
          ? `\n  ROOT CAUSE: this git predates 2.20 and cannot parse this repo's ` +
            `extensions.worktreeConfig. PATH is resolving a stale git (commonly ` +
            `/usr/local/bin/git from the 2018 git-osx-installer). Fix PATH order, ` +
            `or set GIT_BIN=/usr/bin/git.`
          : ""),
    };
  }
  return { status: "ok", detail: version };
}

/**
 * Placeholder tokens harvested from tracked *.example files.
 *
 * REFUSES (throws) when the corpus cannot be loaded from a git that is present and
 * a repo that is present — a preflight guard that lost its input must never report
 * green. Observed 2026-07-18 on a `--wipe --dry-run`: git failed, this function
 * warned, and the scan printed "✅ no deploy-breaking placeholder values" having
 * lost half its detection.
 *
 * The harvest itself stays CONSERVATIVE on purpose. It is tempting to harvest every
 * host-shaped operator-input value from the *.example files — but measured on this
 * repo that flags production: the .example files carry REAL reference hostnames
 * (aisha.guru appears in 6 of them, id3a.cz in 5), so such a harvest marks
 * `APP_DOMAIN=web.aisha.guru` as a placeholder and refuses the real deploy.
 * Repo-specific augmentation therefore stays limited to reserved-TLD hosts; the
 * vendor-neutral filler words are handled by PLACEHOLDER_PATTERNS instead, where
 * they can be matched as domain LABELS rather than substrings.
 */
export function deriveExtraTokens() {
  const probe = probeGit();
  CORPUS_STATUS = probe.status;
  CORPUS_DETAIL = probe.detail;

  if (probe.status === "broken") {
    throw new Error(`placeholder-scan: placeholder corpus unavailable — ${probe.detail}`);
  }
  if (probe.status !== "ok") {
    process.stderr.write(
      `⚠️  placeholder-scan: PARTIAL — ${probe.detail}. ` +
        `Repo-specific placeholder corpus NOT loaded; standards patterns only.\n`,
    );
    return [];
  }

  const files = execFileSync(GIT_BIN, ["ls-files", "*.example"], {
    encoding: "utf8",
    cwd: ROOT,
  })
    .split("\n")
    .filter(Boolean);

  const tokens = new Set();
  for (const rel of files) {
    const abs = resolve(ROOT, rel); // cwd-independent — was existsSync(rel)
    if (!existsSync(abs)) continue;
    let txt = "";
    try {
      txt = readFileSync(abs, "utf8");
    } catch (e) {
      throw new Error(`placeholder-scan: tracked ${rel} unreadable: ${e.message}`);
    }
    // hostname-ish literals ending in a reserved placeholder TLD
    for (const m of txt.matchAll(
      /\b(?:[a-z0-9-]+\.)+(?:example\.(?:com|net|org)|example|test)\b/gi,
    )) {
      const tok = m[0].toLowerCase();
      if (!SENTINEL_PATTERNS.some((re) => re.test(tok))) tokens.add(tok);
    }
  }
  return [...tokens];
}

let _extra;
function extraTokens() {
  if (!_extra) _extra = deriveExtraTokens();
  return _extra;
}

/** True if a resolved VALUE looks like a placeholder (and is not a sentinel). */
export function isPlaceholder(value) {
  if (!value) return false;
  if (SENTINEL_PATTERNS.some((re) => re.test(value))) return false;
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(value))) return true;
  const v = value.toLowerCase();
  return extraTokens().some((tok) => v.includes(tok));
}

/**
 * Scan KEY=VALUE text; return [{key,value,severity}] of placeholder-bearing
 * non-secret keys.
 *   severity 'blocking'  — a hostname/registry/URL/domain placeholder that
 *                          breaks the deploy (image pulls / routing). HARD FAIL.
 *   severity 'cosmetic'  — an email-shaped placeholder (admin@example.com): a
 *                          login/notification address, not deploy-breaking.
 *                          Worth fixing, but must NOT block a prod wipe.
 */
export function scanEnv(text) {
  const offenders = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (SECRET_KEY.test(key)) continue;
    const value = m[2].replace(/^["']|["']$/g, "").trim();
    // A value that IS a leaked inline comment (`# ...`) is structurally invalid —
    // a deploy-breaking config error (2026-06-30: AISHA_INSTANCE_DATA_GIT_URL
    // captured `# https://...` from a .example trailing comment, shadowing the
    // real URL → instance-data overlay never applied). `#FF6A1A` (hash, no space)
    // is a legit color, so require `# ` (hash-then-whitespace).
    const isCommentLeak = /^#\s/.test(value);
    if (!isPlaceholder(value) && !isCommentLeak) continue;
    const severity = isCommentLeak ? "blocking" : value.includes("@") ? "cosmetic" : "blocking";
    offenders.push({ key, value, severity });
  }
  return offenders;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
// Strážce vstupu má jeden domov: lib/cli-entry.mjs. Dřív tu stálo porovnání
// `import.meta.url === `file://${process.argv[1]}`` — to je ale porovnání
// ZÁPISU cesty: URL je percent-enkódovaná, argv[1] syrový. Na cestě s
// diakritikou se rozejdou a blok se TIŠE přeskočí (naměřeno 2026-08-14:
// resolver vydal 0 bajtů s kódem 0 a shodil tím dvanáct bran).
const isMain = isDirectRun(import.meta.url);
if (isMain) {
  const file = process.argv[2];
  let text = "";
  try {
    text = file && existsSync(file) ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  } catch (e) {
    process.stderr.write(`placeholder-scan: cannot read input: ${e.message}\n`);
    process.exit(2);
  }
  const offenders = scanEnv(text);
  const blocking = offenders.filter((o) => o.severity === "blocking");
  const cosmetic = offenders.filter((o) => o.severity === "cosmetic");
  if (cosmetic.length) {
    process.stderr.write(
      `⚠️  placeholder-scan: ${cosmetic.length} COSMETIC placeholder(s) — not deploy-breaking, ` +
        `but should be set to a real value:\n` +
        cosmetic.map((o) => `   ${o.key}=${o.value}`).join("\n") + "\n",
    );
  }
  if (blocking.length) {
    process.stderr.write(
      `❌ placeholder-scan: ${blocking.length} DEPLOY-BREAKING placeholder(s) — a real deploy ` +
        `would fail (e.g. image pulls against an example registry):\n` +
        blocking.map((o) => `   ${o.key}=${o.value}`).join("\n") +
        `\nSet real operator values (TLDs / registry / domains) before deploying.\n`,
    );
    process.exit(1);
  }
  process.stderr.write(
    `✅ placeholder-scan: no deploy-breaking placeholder values in resolved deploy env` +
      (cosmetic.length ? ` (${cosmetic.length} cosmetic warned above)` : "") + "\n",
  );
  process.exit(0);
}
