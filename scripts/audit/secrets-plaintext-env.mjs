#!/usr/bin/env node
// =============================================================================
// secrets-plaintext-env.mjs — Phase 12 WP 3.7 secret-env audit
// =============================================================================
// Flags LITERAL hardcoded secret VALUES committed to docker-compose.coolify*.yml
// files. A value that is a pure `${VAR}` env interpolation (optionally with
// `${VAR:-default}` / `${VAR:?msg}` syntax) is CLEAN — interpolation is the
// endorsed pattern for non-secret-at-rest (see the investigation doc §2.A,
// "Compatible with existing ${VAR} substitution"). The remaining at-runtime
// exposure of those interpolated values is a separate, deferred concern handled
// by the future runtime-env gate (investigation §5.3), NOT by this static gate.
//
// HISTORY: this script used to count `${SECRET_NAME}` ENV-INTERPOLATION
// REFERENCES — i.e. the captured VARIABLE NAME inside `${...}` — not literal
// values. That was wrong in both directions:
//   (a) a genuinely hardcoded literal (`PASSWORD: hunter2-actual-plaintext`)
//       scored 0 — the gate was BLIND to the very leaks it claimed to catch;
//   (b) a harmless interpolation (`redis://:${REDIS_PASSWORD}@host`) scored 1
//       and was treated as a regression, pushing a developer toward a broken
//       config and an inflated baseline (282 -> 283 in commit 207da466).
// The gate now measures REAL leaks: literal secret material that survives
// removal of every `${...}` span. The baseline is therefore a literal-leak
// count (ideally 0), NOT a reference-token count.
//
// FINDING semantics:
//   A finding = an `environment` assignment whose KEY looks secret-like
//   (PASSWORD|SECRET|TOKEN|KEY|API[_-]?KEY|DSN|CRED|CREDS|PRIVATE; minus the
//   ALLOWLIST of false-positive names) AND whose VALUE, after stripping every
//   `${...}` span and surrounding URL/quoting punctuation, STILL contains a
//   non-trivial literal secret token:
//     - a run of >=16 consecutive [A-Za-z0-9+/_=-] (base64/hex-like), OR
//     - an inline credential `://user:password@` whose password segment
//       (>=8 chars) is NOT a `${...}` reference.
//   A value that is purely `${...}` (or whose only credential material lives
//   inside `${...}`) scores 0 — PASS — whether standalone or inside a URL.
//
// Output: JSON to stdout with the per-file breakdown + total.
//
// USAGE:
//   node scripts/audit/secrets-plaintext-env.mjs               # report only
//   node scripts/audit/secrets-plaintext-env.mjs --json        # machine read
//   node scripts/audit/secrets-plaintext-env.mjs --check       # exit 1 if >baseline
//   node scripts/audit/secrets-plaintext-env.mjs --write-baseline  # snapshot
// =============================================================================
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectRun } from '../lib/cli-entry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const BASELINE_PATH = join(
  REPO_ROOT,
  'src/tests/gates/wp-3-7-secrets-no-plaintext.baseline.json',
);

const JSON_OUT = process.argv.includes('--json');
const CHECK_MODE = process.argv.includes('--check');
const WRITE_BASELINE = process.argv.includes('--write-baseline');

// A KEY (env-var name) that almost certainly holds a secret value: the
// secret-signalling word may appear anywhere in the name, including at the
// start (`PASSWORD`, `SECRET`) or embedded (`KEYCLOAK_ADMIN_PASSWORD`).
const SECRET_KEY_PATTERN =
  /(?:PASSWORD|SECRET|TOKEN|API[_-]?KEY|KEY|DSN|CREDS|CRED|PRIVATE)/;

// Allowlist: names that match the secret-key pattern but are NOT secrets at
// rest (public material, numeric tunables, public identifiers). Even when a
// literal value is present for these, it is not a leak.
const ALLOWLIST = new Set([
  'PUBLIC_KEY', // public material
  'KEYCLOAK_REALM', // public identifier
  'TOKEN_REFRESH_INTERVAL', // numeric
  'TOKEN_EXPIRY', // numeric
  'TOKEN_EXPIRY_SECONDS', // numeric
  'KEY_LENGTH', // numeric
]);

// Obvious non-secret sentinel/placeholder values — deliberate "not configured /
// not integrated" markers, never real secrets. Matched case-insensitively
// against a literal segment. Two flavours:
//   - exact words (`none`, `disabled`, `changeme`, ...)
//   - hyphen/underscore phrases that START with a sentinel prefix, e.g.
//     `not-integrated-aisha-rpc-replaces-it`, `not-used-in-self-hosted`,
//     `change-me-please`, `replace-with-real-value`.
const SENTINEL_RE =
  /^(?:(?:not|no|none|null|nil|empty|unset|disabled?|change[-_]?me|changeme|placeholder|example|sample|dummy|fake|todo|tbd|redacted|replace|n\/?a|true|false|xxx+)(?:[-_].*)?)$/i;

// `${VAR}`, `${VAR:-default}`, `${VAR:?msg}`, `${VAR:+alt}`, `$VAR`, `$$VAR`
// (the `$$` Coolify/compose escape) — every form of env interpolation.
const INTERPOLATION_SPAN = /\$\$?\{[^}]*\}|\$\$?[A-Za-z_][A-Za-z0-9_]*/g;

// A residual literal that looks like real secret material: >=16 consecutive
// base64/hex-like characters. Note `/` is deliberately EXCLUDED — it is URL/
// path structure, not secret material (otherwise `https://host/a/b/c` reads as
// one long run). Residues are split on `/ : @` + whitespace before testing, so
// only an individual opaque segment can match.
const LITERAL_TOKEN = /[A-Za-z0-9+_=-]{16,}/;

// An inline credential `scheme://user:password@host`. The user part may be
// empty (`redis://:pw@host`). Capture the password segment for inspection.
const INLINE_CRED = /:\/\/[^:@/\s]*:([^@/\s]+)@/g;

/**
 * Is this password segment (the `:PW@` portion of a URL userinfo) a literal
 * secret rather than a pure `${...}` interpolation? Clean iff, after removing
 * every interpolation span, no meaningful literal credential material remains.
 */
function isLiteralPassword(pw) {
  const residue = pw.replace(INTERPOLATION_SPAN, '');
  // strip URL-percent / punctuation noise, keep credential-ish chars
  const meaningful = residue.replace(/[^A-Za-z0-9+_=-]/g, '');
  return meaningful.length >= 8 && !SENTINEL_RE.test(meaningful);
}

/**
 * Decide whether a single (key, value) assignment is a literal secret leak.
 *
 * Two independent paths flag a leak:
 *   (1) An inline credential `scheme://user:LITERAL_PW@host` anywhere in the
 *       value — a literal password baked into a connection URL leaks REGARDLESS
 *       of the key name (a `redis://:pw@` URL is a leak whether the key is
 *       REDIS_URL, CACHE_DSN, or anything). An interpolated password is clean.
 *   (2) For a secret-like KEY only, a bare literal token (>=16 opaque chars)
 *       in the value once every `${...}` span is removed. Key-gating here
 *       avoids flagging long but innocuous identifiers under non-secret keys.
 *
 * Interpolation (`${VAR}` in any form) is NEVER a leak — it is the endorsed
 * pattern (investigation §2.A) and the at-runtime exposure of its resolved
 * value is a separate, deferred concern (§5.3).
 */
function isLiteralLeak(key, rawValue) {
  // Strip a trailing inline `# comment` (whitespace-preceded `#`), then strip
  // surrounding YAML quotes/whitespace. Comment prose must never be mistaken
  // for a secret value.
  let value = rawValue.replace(/\s+#.*$/, '').trim();
  value = value.replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
  if (value === '') return false;

  // (1) Inline-credential path — key-agnostic. If the value embeds
  //     `scheme://user:PW@host`, only the password segment is secret material
  //     (host/path/db-name are not). A literal PW is a leak; a `${...}` PW is
  //     clean. We do NOT fall through to scan the rest of the URL.
  const creds = [...value.matchAll(INLINE_CRED)];
  if (creds.length > 0) {
    return creds.some((m) => isLiteralPassword(m[1]));
  }

  // (2) Bare-token path — only for secret-like keys (minus the allowlist).
  if (!SECRET_KEY_PATTERN.test(key) || ALLOWLIST.has(key)) return false;

  // Remove every interpolation span, then split on URL/path structure so each
  // opaque segment is judged on its own. Flag if any segment is a long literal
  // token that is not a known sentinel.
  const residue = value.replace(INTERPOLATION_SPAN, ' ');
  for (const segment of residue.split(/[/:@\s]+/)) {
    if (segment === '' || SENTINEL_RE.test(segment)) continue;
    if (LITERAL_TOKEN.test(segment)) return true;
  }
  return false;
}

/**
 * Extract (key, value) env assignments from a compose file's text. Handles
 * both the mapping form (`KEY: value`) and the list form (`- KEY=value`).
 * We do not need a full YAML parse — secrets live in flat env assignments.
 */
function extractAssignments(text) {
  const out = [];
  for (const rawLine of text.split('\n')) {
    // Drop trailing inline `#` comments only when clearly not inside a value;
    // we keep it simple and skip whole-line comments.
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // List form:  - KEY=value   (compose `environment:` list entries)
    let m = /^-\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (m) {
      out.push({ key: m[1], value: m[2] });
      continue;
    }

    // Mapping form:  KEY: value   (compose `environment:` mapping entries)
    // Require an uppercase-ish env key and a non-empty value on the same line
    // (block scalars / nested maps are not env-secret assignments).
    m = /^([A-Za-z_][A-Za-z0-9_]*):\s+(\S.*)$/.exec(trimmed);
    if (m) {
      out.push({ key: m[1], value: m[2] });
    }
  }
  return out;
}

async function scanComposeFiles() {
  const entries = await readdir(REPO_ROOT);
  const composeFiles = entries
    .filter((f) => f.startsWith('docker-compose.coolify') && f.endsWith('.yml'))
    .sort();

  const perFile = {};
  const findings = [];
  let total = 0;

  for (const file of composeFiles) {
    const text = await readFile(join(REPO_ROOT, file), 'utf8');
    let count = 0;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const { key, value } of extractAssignments(lines[i])) {
        if (isLiteralLeak(key, value)) {
          count += 1;
          findings.push({ file, line: i + 1, key, valueLength: value.trim().length });
        }
      }
    }
    if (count > 0) {
      perFile[file] = count;
      total += count;
    }
  }

  return { perFile, total, findings };
}

async function readBaseline() {
  try {
    const text = await readFile(BASELINE_PATH, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  const { perFile, total, findings } = await scanComposeFiles();
  const result = { perFile, total };

  if (WRITE_BASELINE) {
    const baseline = {
      generated_at: new Date().toISOString().slice(0, 10),
      wp: 'phase-12-wp-3.7',
      description:
        'LITERAL hardcoded secret values committed to docker-compose.coolify*.yml files. ' +
        'A value that is a pure ${VAR} interpolation scores 0 (interpolation is endorsed — ' +
        'investigation §2.A). Ratchet-down only — gate fails if total INCREASES above this ' +
        'baseline. Ideally 0: any real leak must be FIXED (file-mount migration §5.1), not baselined.',
      total,
      perFile,
    };
    await writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
    process.stdout.write(
      `Baseline written: total=${total} files=${Object.keys(perFile).length}\n`,
    );
    return;
  }

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ ...result, findings }, null, 2) + '\n');
  } else {
    process.stdout.write(`Literal plaintext secrets: ${total}\n`);
    for (const [file, count] of Object.entries(perFile)) {
      process.stdout.write(`  ${file}: ${count}\n`);
    }
    for (const f of findings) {
      // Never print the secret value — key + location + length only.
      process.stdout.write(
        `    LEAK ${f.file}:${f.line} ${f.key} (literal value, ${f.valueLength} chars — REDACTED)\n`,
      );
    }
  }

  if (CHECK_MODE) {
    const baseline = await readBaseline();
    if (!baseline) {
      process.stderr.write(
        `error: --check mode but no baseline at ${BASELINE_PATH}\n` +
          `       run with --write-baseline first\n`,
      );
      process.exit(2);
    }
    if (total > baseline.total) {
      process.stderr.write(
        `\nFAIL: literal plaintext secrets increased ${baseline.total} -> ${total}\n` +
          `       A NEW hardcoded secret VALUE was committed to a compose file.\n` +
          `       Fix it: use a ${'${VAR}'} env interpolation, or migrate the secret to a\n` +
          `       Coolify file-mount (FOO_FILE=/run/secrets/foo) per\n` +
          `       docs/security/SECRETS_MANAGEMENT_INVESTIGATION_2026-05-20.md §5.1.\n` +
          `       Do NOT regenerate the baseline to absorb a real leak.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `\nOK: literal plaintext secrets ${total} <= baseline ${baseline.total}\n`,
    );
  }
}

// Pure functions are exported for unit testing (the gate's fixture table).
export { isLiteralLeak, isLiteralPassword, extractAssignments };

// Only run the CLI when invoked directly (not when imported by a test).
if (isDirectRun(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(2);
  });
}
