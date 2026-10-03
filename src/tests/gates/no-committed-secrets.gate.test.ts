/**
 * Gate test: no-committed-secrets
 *
 * Enforces the AISHA "no infra in repo" invariant (see memory rule
 * `feedback_no_infra_in_repo.md`): runtime credentials MUST be loaded
 * from `.env-prod-backup` or generated at cold-start time — NEVER
 * committed as literal values in tracked files.
 *
 * Past offenders cleaned up by `chore/sanitize-committed-secrets`
 * (2026-05-25 audit):
 *   - scripts/_find-coolify-api.mjs      (deleted, investigative one-shot)
 *   - scripts/_investigate-coolify.mjs   (deleted)
 *   - scripts/deploy-oauth-coolify.mjs   (sanitized → reads from env)
 *   - scripts/coolify-deploy-init.sh     (sanitized → require_secret)
 *
 * Patterns enforced:
 *   1. No Coolify API token literal — `[0-9]+\|[A-Za-z0-9]{42,}` is
 *      Coolify v4's `<id>|<token>` Bearer format.
 *   2. No ES256-signed Apple OAuth client JWT — header `eyJhbGciOiJFUzI1Ni`
 *      (ECDSA P-256) with a payload + signature triple is the Apple
 *      JWT shape; signed with the operator's private key.
 *   3. No bare 32+ char secret on the right side of a `=` in shell `:-`
 *      defaults (i.e. `FOO="${FOO:-<actual-secret>}"`) EXCEPT well-known
 *      invalidated `.fallback` markers and placeholder `changeme*` values.
 *   4. No committed PostgREST JWT whose decoded payload carries a
 *      privileged `role`. This decodes the payload of ANY 3-segment `eyJ…`
 *      token (HS256 included — the prior gate only matched ES256):
 *        - role === "service_role"  → ALWAYS a finding. A service_role token
 *          bypasses RLS (full DB access); it is never a "public demo" value,
 *          so this check IGNORES PUBLIC_DEMO_EXCEPTIONS entirely.
 *        - role === "anon"          → a finding UNLESS the file is a genuinely
 *          public surface (PUBLIC_DEMO_EXCEPTIONS). anon is publishable, but
 *          must still be env-driven in scripts/tests/builds.
 *        - any other / no role      → ignored (jwt.io example + expired test
 *          fixtures are not credentials).
 *
 * Scope: scripts/, services/, packages/ — but NOT
 *   - .env*, .git/, node_modules/, dist/
 *   - .aisha/ (generated)
 *   - packages/insight/ (submodule)
 *   - any file matching the public-demo exception list below (anon only;
 *     service_role is never exempt)
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Files where a committed *anon* JWT is acceptable because the surface is
 *  genuinely public-by-design. NOTE: this exemption applies to `role: "anon"`
 *  ONLY — a `service_role` token is forbidden here too (see scanFile). The
 *  previously-exempt scripts/mobile/template files were scrubbed to read their
 *  anon key from env, so they are deliberately NOT listed here anymore: a
 *  future embed in any of them is now caught (no standing allowlist). */
const PUBLIC_DEMO_EXCEPTIONS: ReadonlyArray<string> = [
  // The published public app config literally serves the anon key to clients.
  'public/.well-known/app-config.json',
  // The gate test itself documents the alg-header prefixes it scans for.
  'src/tests/gates/no-committed-secrets.gate.test.ts',
];

/** Decode a JWT payload's `role` claim without verifying the signature.
 *  Returns undefined if the token is malformed or carries no role. */
function decodeJwtRole(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(payload, 'base64').toString('utf8');
    const claims = JSON.parse(json) as { role?: unknown };
    return typeof claims.role === 'string' ? claims.role : undefined;
  } catch {
    return undefined;
  }
}

function listTrackedFiles(): string[] {
  // Use git ls-files so the gate doesn't traverse node_modules/dist/etc.
  // execFileSync (not execSync) per repo security hook — no shell parsing,
  // no injection surface even though there's no user input here.
  const out = execFileSync('git', ['ls-files'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024, // 32MB headroom for large monorepos
  });
  return out
    .split('\n')
    .filter((p) => p.length > 0)
    .filter((p) => {
      // Skip binary-ish + non-relevant trees
      if (p.startsWith('packages/insight/')) return false;
      if (p.startsWith('node_modules/')) return false;
      if (p.startsWith('dist/')) return false;
      // `trash/` is archived legacy state — not subject to the
      // no-committed-secrets invariant. Anything live should never be
      // pulled out of trash/ again. Tracked here so the directory is
      // preserved for historical audit, but excluded from the gate.
      if (p.startsWith('trash/')) return false;
      if (p.endsWith('.lock')) return false;
      if (p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.ico')) return false;
      if (p.endsWith('.svg')) return false; // SVGs can be huge
      if (p.endsWith('.pdf')) return false;
      if (p.endsWith('package-lock.json')) return false;
      return true;
    });
}

interface Finding {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
  /** When true, the finding is suppressed for files in PUBLIC_DEMO_EXCEPTIONS.
   *  service_role JWTs set this false → never exempt. */
  exemptable: boolean;
}

/** Shannon entropy in bits/char — random base64/base36 tokens sit ~3.5–6.0,
 *  hyphenated hostnames / english words sit well below 3.0. */
function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** True when a bare string literal looks like a real committed secret VALUE
 *  (random base64url / base64 / hex token), as opposed to a placeholder,
 *  a hostname/path, a version, or a checksum/hash.
 *
 *  Rationale: a hardcoded credential is almost always a high-entropy token
 *  bound to a secret-named identifier (see caller). We keep the value test
 *  tight so it fires on the token itself and not on adjacent noise:
 *    - length 20..100 within the base64url/base64/hex charset
 *    - must mix a letter AND a digit (filters all-lowercase hostnames like
 *      `aisha-backend-integration` and pure-number literals)
 *    - entropy ≥ 3.0 bits/char (filters dictionary-ish / templated strings)
 *    - NOT a bare hash/ref length in pure hex (git sha / md5 / sha256/512)
 *    - NOT a documented placeholder prefix. */
function looksLikeCommittedSecret(v: string): boolean {
  if (v.length < 20 || v.length > 100) return false;
  if (!/^[A-Za-z0-9_+/=~-]+$/.test(v)) return false;
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return false;
  // Documented placeholders / invalidated markers (mirror pattern 3 allowlist).
  if (
    v.endsWith('.fallback') ||
    /^(changeme|super-secret|your-|example-|placeholder|dummy|test-|fake-|redacted)/i.test(v)
  ) {
    return false;
  }
  // Universal "this is fixture / local-dev data, not a real credential" markers.
  // None of these substrings occur in a random base64url/hex token (a 10-char
  // sequential decimal run or a 5×`x` run has ~0 probability in real output),
  // so keying on them recognises obvious placeholders without masking secrets:
  //   dev_secret_…__padding, *-local-secret-2026, aisha-throwaway-…, MOCK_…,
  //   healthy-jwt-secret-0123456789…, shortjwt20charsxxxxx.
  if (
    /0123456789/.test(v) ||
    /x{5,}/i.test(v) ||
    /(local-secret|throwaway|padding|healthy|sample|fixture|mock|dev[_-]secret)/i.test(v)
  ) {
    return false;
  }
  // Pure-hex tokens at canonical hash/ref lengths are checksums, not secrets.
  if (/^[0-9a-f]+$/i.test(v) && [7, 8, 32, 40, 64, 128].includes(v.length)) return false;
  return shannonEntropy(v) >= 3.0;
}

/** Secret-intent identifier — a variable / case-label / property whose NAME
 *  says it holds a credential. Deliberately excludes `_ID`, `_URL`, `_HOST`,
 *  `_USER`, `_EMAIL`, `_NAME` which are not secrets. */
const SECRET_NAME_RE =
  /(?<![A-Za-z0-9])[A-Z][A-Z0-9_]*(SECRET|PASSWORD|PASSWD|_TOKEN|TOKEN_|APIKEY|API_KEY|_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL|MNEMONIC)[A-Z0-9_]*/;

/** Join bash line-continuations (`\` at EOL) so a `case` arm whose label and
 *  value span two physical lines becomes one logical line. Returns
 *  `{text, line}` where `line` is the 1-indexed physical start line. */
function toLogicalLines(lines: string[]): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  let buf = '';
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (buf === '') start = i + 1;
    if (raw.endsWith('\\')) {
      buf += raw.slice(0, -1) + ' ';
      continue;
    }
    out.push({ text: buf + raw, line: start });
    buf = '';
  }
  if (buf !== '') out.push({ text: buf, line: start });
  return out;
}

function scanFile(path: string): Finding[] {
  let content: string;
  try {
    content = readFileSync(join(ROOT, path), 'utf8');
  } catch {
    return []; // unreadable / deleted / not present in worktree
  }
  const findings: Finding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // (1) Coolify v4 API token: `<digits>|<42+chars>` Bearer format.
    //     Match only when it looks like a real credential assignment.
    const coolifyMatch = line.match(/(['"])(\d+\|[A-Za-z0-9_-]{42,})\1/);
    if (coolifyMatch) {
      findings.push({
        file: path,
        line: i + 1,
        pattern: 'coolify-api-token',
        snippet: line.trim().slice(0, 120),
        exemptable: true,
      });
    }

    // (4) Any 3-segment JWT whose decoded payload carries a privileged role.
    //     HS256-included (the Apple matcher above only catches ES256). A
    //     service_role token is forbidden everywhere; anon only outside the
    //     public-demo surfaces. Other/no-role tokens (fixtures) are ignored.
    const jwtRegex =
      /eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
    let jwtMatch: RegExpExecArray | null;
    while ((jwtMatch = jwtRegex.exec(line)) !== null) {
      const role = decodeJwtRole(jwtMatch[0]);
      if (role === 'service_role' || role === 'anon') {
        findings.push({
          file: path,
          line: i + 1,
          pattern: `committed-${role}-jwt`,
          snippet: line.trim().slice(0, 80),
          exemptable: role !== 'service_role', // service_role: never exempt
        });
      }
    }

    // (2) Apple OAuth client secret JWT: ES256 (alg=ES256) header followed
    //     by base64-url payload + signature. Header literal is the
    //     standard `eyJhbGciOiJFUzI1Ni` (decodes to {"alg":"ES256",…).
    //     We require all 3 dot-separated segments to keep the match tight.
    const appleJwtMatch = line.match(
      /(['"])(eyJhbGciOiJFUzI1Ni[A-Za-z0-9_=-]+\.eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+)\1/,
    );
    if (appleJwtMatch) {
      findings.push({
        file: path,
        line: i + 1,
        pattern: 'apple-oauth-jwt',
        snippet: line.trim().slice(0, 120),
        exemptable: true,
      });
    }

    // (3) Bash `${VAR:-<actual-value>}` with what looks like a real secret
    //     (32+ chars of mixed alphanum WITHOUT slashes, dots, or `super-`
    //     prefix). Slashes mean filesystem path; dots mean version/hostname;
    //     `super-secret-…` is a documented demo placeholder string.
    //     Skip lines containing `$(` (command substitution like
    //     `openssl rand -hex 32`).
    if (!line.includes('$(')) {
      const bashDefault = line.match(
        /\$\{[A-Z_][A-Z0-9_]*:-([A-Za-z0-9_+=-]{32,})\}/,
      );
      if (bashDefault) {
        const value = bashDefault[1];
        // Allow well-known invalidated fallback markers, placeholder
        // strings, and obvious-not-secret tokens
        const allowed =
          value.endsWith('.fallback') ||
          value.startsWith('changeme') ||
          value.startsWith('super-secret') ||
          value.startsWith('your-') ||
          value.startsWith('example-') ||
          /^([A-Za-z0-9])\1+$/.test(value) || // all same char (e.g. 0000…0)
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value); // UUID placeholder
        if (!allowed) {
          findings.push({
            file: path,
            line: i + 1,
            pattern: 'bash-default-secret',
            snippet: line.trim().slice(0, 120),
            exemptable: true,
          });
        }
      }
    }
  }

  // (5) High-entropy secret literal DIRECTLY BOUND to a secret-named
  //     identifier — the form patterns 1–4 miss. The value must be the
  //     immediate right-hand side of the name (assignment, case-arm, or
  //     property), not merely co-located on the same line, so prose that
  //     mentions a secret NAME, `uuid=<coolify-slug>` URLs, and n8n jsCode
  //     blobs do not trip it. Concretely it catches:
  //       S3_SECRET_KEY) echo "<43-char base64url>" ;;
  //       NOCODB_DB_PASSWORD|…|N8N_DB_PASSWORD) \       ← label + value split
  //         echo "<43-char base64url>" ;;                 (continuation joined)
  //       AISHA_JWT_SECRET="<random>"      SOME_TOKEN=<random>
  //       "APP_SECRET": "<random>"
  //     env-doctor's `["X_SECRET","alias","Y"]` rows do NOT match (a comma,
  //     not `=`/`:`, separates name from value; value is a KEY name anyway).
  const BINDINGS: RegExp[] = [
    // case-arm:  NAME) echo "val"   /   NAME|OTHER) echo "val"
    /\b([A-Z][A-Z0-9_|]*)\)\s*(?:echo\s+)?["']([A-Za-z0-9_+/=~-]{20,100})["']/g,
    // assignment / property:  NAME="val"  NAME=val  NAME: "val"  "NAME": "val"
    /["']?\b([A-Z][A-Z0-9_]*)["']?\s*[:=]\s*["']?([A-Za-z0-9_+/=~-]{20,100})["']?(?:\s|;|,|$)/g,
  ];
  for (const { text, line } of toLogicalLines(lines)) {
    const trimmed = text.trim();
    if (/^(#|\/\/|\*|<!--)/.test(trimmed)) continue; // comment (placeholders/examples)
    if (text.includes('${') || text.includes('$(')) continue; // expansion, not a literal
    let flagged = false;
    for (const re of BINDINGS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while (!flagged && (m = re.exec(text)) !== null) {
        const name = m[1];
        const value = m[2];
        // The identifier (or any |-alternative of it) must read as a secret.
        if (!name.split('|').some((n) => SECRET_NAME_RE.test(n))) continue;
        if (value.includes('...')) continue; // truncated placeholder
        if (looksLikeCommittedSecret(value)) {
          findings.push({
            file: path,
            line,
            pattern: 'high-entropy-secret-literal',
            snippet: trimmed.slice(0, 120),
            exemptable: true,
          });
          flagged = true;
        }
      }
      if (flagged) break;
    }
  }

  return findings;
}

describe('no-committed-secrets — runtime credentials must not be committed', () => {
  it('no Coolify API token literals, Apple OAuth JWTs, or bash default-value secrets in tracked files', () => {
    if (!existsSync(join(ROOT, '.git'))) {
      // Not a git checkout (e.g. tarball); skip gracefully
      return;
    }
    const files = listTrackedFiles();
    const findings: Finding[] = [];
    for (const f of files) {
      const isExempt = PUBLIC_DEMO_EXCEPTIONS.includes(f);
      for (const finding of scanFile(f)) {
        // Exempt files suppress only exemptable findings (anon JWT, coolify/
        // apple/bash heuristics). service_role JWTs (exemptable:false) are
        // reported even from exempt files — a service token is never public.
        if (isExempt && finding.exemptable) continue;
        findings.push(finding);
      }
    }

    if (findings.length > 0) {
      const lines = findings.map(
        (f) => `  ${f.pattern} @ ${f.file}:${f.line} — ${f.snippet}`,
      );
      throw new Error(
        `Found ${findings.length} committed credential(s) — load from .env-prod-backup or generate at runtime:\n${lines.join('\n')}\n\n` +
          `If a match is a public demo constant (well-known published JWT), add the file path to PUBLIC_DEMO_EXCEPTIONS in this gate test.`,
      );
    }
    expect(findings).toEqual([]);
  });

  // Lock the pattern-5 classifier so a future edit cannot silently blunt it.
  // (This file is in PUBLIC_DEMO_EXCEPTIONS, so these samples are not scanned.)
  it('high-entropy classifier flags real tokens and ignores placeholders/refs', () => {
    // Positive — random base64url / base64 / hex tokens (what a leak looks like).
    const realTokens = [
      'Zk9dJ2mQ7bR4xT1vW8yA3cE6hL5nP0sU2iO4kM7gB9dF', // 44-char base64url random
      'a1B2c3D4e5F6g7H8i9J0kL1mN2oP3qR4', // 32-char mixed
      'f3a9c7e1b5d8204698ec3fa71b0d9e42', // 32-char hex NOT at a hash length? (it is 32 → treated as md5 → ignored, see below)
    ];
    expect(looksLikeCommittedSecret(realTokens[0])).toBe(true);
    expect(looksLikeCommittedSecret(realTokens[1])).toBe(true);
    // 32-char pure hex is a canonical md5 length → treated as a checksum, not a secret.
    expect(looksLikeCommittedSecret(realTokens[2])).toBe(false);

    // Negative — placeholders, fixtures, hostnames, refs, checksums.
    for (const notSecret of [
      'changeme-changeme-changeme-changeme',
      'super-secret-value-for-local-only-x',
      'aisha-app-local-secret-2026',
      'aisha-throwaway-postgrest-jwt-secret-0123456789-abc',
      'dev_secret_32chars__padding_padding_pad',
      'aisha-backend-integration-hostname', // all-lowercase hostname, no digit
      '0123456789abcdef0123456789abcdef01234567', // 40-char git sha (pure hex, ref length)
      'short', // too short
    ]) {
      expect(looksLikeCommittedSecret(notSecret)).toBe(false);
    }

    // Entropy sanity: random > hyphenated words.
    expect(shannonEntropy('Zk9dJ2mQ7bR4xT1vW8yA')).toBeGreaterThan(3.0);
    expect(shannonEntropy('aaaa-bbbb-cccc-dddd')).toBeLessThan(3.0);
  });
});
