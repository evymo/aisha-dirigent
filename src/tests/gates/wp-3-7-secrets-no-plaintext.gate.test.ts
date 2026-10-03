/**
 * Gate test: Phase 12 WP 3.7 — LITERAL plaintext-secret leak gate.
 *
 * SEMANTICS (rewritten): this gate flags ONLY literal committed secret VALUES.
 * A value that is a pure `${VAR}` env interpolation (in any form —
 * `${VAR:-default}`, `${VAR:?msg}`) is CLEAN. Interpolation is the endorsed
 * pattern for non-secret-at-rest (investigation §2.A, "Compatible with existing
 * ${VAR} substitution"); the at-runtime exposure of resolved interpolated
 * values is a separate, deferred concern handled by a FUTURE runtime-env gate
 * (investigation §5.3), NOT by this static gate.
 *
 * HISTORY: the gate previously counted `${SECRET_NAME}` INTERPOLATION REFERENCES
 * (the captured variable name), not literal values. That was blind to real
 * leaks (a hardcoded `PASSWORD: hunter2...` scored 0) and penalised harmless
 * interpolation (`redis://:${REDIS_PASSWORD}@host` scored 1) — which drove a
 * broken config + an inflated 282->283 baseline in commit 207da466. The gate
 * now measures real leaks; the baseline is a literal-leak count (ideally 0).
 *
 * The baseline (`wp-3-7-secrets-no-plaintext.baseline.json`) is therefore the
 * count of literal secret leaks at merge time. It SHOULD be 0. Future PRs that
 * hardcode a NEW literal secret fail HERE. If a service genuinely migrates a
 * secret to a Coolify file-mount and the count drops, regenerate with:
 *
 *   node scripts/audit/secrets-plaintext-env.mjs --write-baseline
 *
 * NEVER regenerate the baseline to ABSORB a real leak — fix the leak instead.
 *
 * Also enforces:
 *   - Investigation doc exists with required sections
 *   - Audit script exists + is invokable
 *   - Baseline file exists + parses
 *   - The detection heuristic catches literal secrets and passes ${VAR}
 *     interpolation (the canonical fixture table).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isLiteralLeak } from '../../../scripts/audit/secrets-plaintext-env.mjs';

const ROOT = process.cwd();
const INVESTIGATION_DOC = path.join(
  ROOT,
  'docs/security/SECRETS_MANAGEMENT_INVESTIGATION_2026-05-20.md',
);
const AUDIT_SCRIPT = path.join(
  ROOT,
  'scripts/audit/secrets-plaintext-env.mjs',
);
const BASELINE = path.join(
  ROOT,
  'src/tests/gates/wp-3-7-secrets-no-plaintext.baseline.json',
);

interface Baseline {
  generated_at: string;
  wp: string;
  description: string;
  total: number;
  perFile: Record<string, number>;
}

describe('Phase 12 WP 3.7 — investigation doc', () => {
  it('SECRETS_MANAGEMENT_INVESTIGATION_2026-05-20.md exists', () => {
    expect(fs.existsSync(INVESTIGATION_DOC)).toBe(true);
  });

  it('doc has TL;DR + threat model + options + decision matrix + migration plan', () => {
    const src = fs.readFileSync(INVESTIGATION_DOC, 'utf8');
    // structural anchors — survive renumbering / minor edits
    expect(src).toMatch(/TL;DR/);
    expect(src).toMatch(/[Tt]hreat model/);
    expect(src).toMatch(/Coolify v4 native|Coolify native/);
    expect(src).toMatch(/Vault/);
    expect(src).toMatch(/[Dd]ecision matrix/);
    expect(src).toMatch(/[Mm]igration plan|[Mm]igration [pP]hase/);
    expect(src).toMatch(/[Rr]ollback/);
  });

  it('doc explicitly chooses Option A (Coolify file-mount)', () => {
    const src = fs.readFileSync(INVESTIGATION_DOC, 'utf8');
    expect(src).toMatch(
      /[Aa]dopt Option A|Decision[\s\S]{0,400}Coolify v4 native file-mount/,
    );
  });
});

describe('Phase 12 WP 3.7 — audit script + baseline', () => {
  it('audit script exists at scripts/audit/secrets-plaintext-env.mjs', () => {
    expect(fs.existsSync(AUDIT_SCRIPT)).toBe(true);
  });

  it('audit script is executable JS (shebang present)', () => {
    const src = fs.readFileSync(AUDIT_SCRIPT, 'utf8');
    expect(src.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('audit script supports --json, --check, --write-baseline modes', () => {
    const src = fs.readFileSync(AUDIT_SCRIPT, 'utf8');
    expect(src).toMatch(/--json/);
    expect(src).toMatch(/--check/);
    expect(src).toMatch(/--write-baseline/);
  });

  it('baseline file exists at expected path', () => {
    expect(fs.existsSync(BASELINE)).toBe(true);
  });

  it('baseline file parses + has required fields (literal-leak count)', () => {
    const data = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Baseline;
    expect(data.wp).toBe('phase-12-wp-3.7');
    expect(typeof data.total).toBe('number');
    // Literal-leak count: 0 is the GOOD state (no hardcoded secrets committed).
    expect(data.total).toBeGreaterThanOrEqual(0);
    expect(data.perFile).toBeTypeOf('object');
  });
});

describe('Phase 12 WP 3.7 — detection heuristic (canonical fixture table)', () => {
  // The whole point of the rewrite: catch REAL literal leaks, and treat any
  // pure `${VAR}` interpolation as clean — whether standalone or inside a URL.
  const FLAGGED: ReadonlyArray<readonly [string, string]> = [
    // hardcoded literal secret value
    ['PASSWORD', 'hunter2-actual-plaintext-value-xyz12345'],
    // literal inline credential in a URL (password baked in)
    ['REDIS_URL', 'redis://:s3cr3tLiteralPassw0rdABCDEF@h:6379'],
    // base64-like literal blob under a secret-like key
    ['JWT_SECRET', 'dGhpc0lzQVJlYWxCYXNlNjRTZWNyZXRWYWx1ZTEyMzQ1Ng=='],
  ];
  const CLEAN: ReadonlyArray<readonly [string, string]> = [
    // interpolated password inside a URL
    ['AISHA_SHARED_REDIS_URL', 'redis://core:${REDIS_PASSWORD_CORE}@h:6379'],
    // pure interpolation, standalone
    ['AISHA_SHARED_REDIS_PASSWORD', '${REDIS_PASSWORD}'],
    // interpolation with required-syntax
    ['POSTGRES_PASSWORD', '${POSTGRES_PASSWORD:?required}'],
    // allowlisted public identifier
    ['KEYCLOAK_REALM', 'aisha'],
    // interpolated DSN — only host/db is literal (not a secret)
    [
      'POSTMOOGLE_DB_DSN',
      'postgres://synapse_user:${SYNAPSE_DB_PASSWORD}@aisha-db:5432/synapse_bridge_email?sslmode=disable',
    ],
    // public OIDC endpoint URL with interpolated domain
    [
      'KC_TOKEN_URL',
      'https://${KEYCLOAK_DOMAIN}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token',
    ],
    // pure interpolation followed by an inline comment
    [
      'INTRANET_API_KEY',
      '${INTRANET_API_KEY:?required}  # gateway /token-exchange; see generate-secrets.mjs',
    ],
    // deliberate "not integrated" sentinel placeholders
    ['KRONOS_API_KEY', '"not-integrated-aisha-rpc-replaces-it"'],
    ['PACKAGE_REGISTRY_TOKEN', '"not-used-in-self-hosted"'],
  ];

  it.each(FLAGGED)('FLAGS literal leak: %s', (key, value) => {
    expect(isLiteralLeak(key, value)).toBe(true);
  });

  it.each(CLEAN)('PASSES (clean): %s', (key, value) => {
    expect(isLiteralLeak(key, value)).toBe(false);
  });
});

describe('Phase 12 WP 3.7 — ratchet-down enforcement', () => {
  // Re-run the audit live + compare to the committed baseline. A PR that
  // hardcodes a NEW literal secret into a compose file fails HERE before merge.
  it('current literal-secret count ≤ baseline (ratchet-down only)', () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Baseline;

    // Invoke the audit script with --json (read-only) using execFile (no shell)
    const stdout = execFileSync(
      process.execPath,
      [AUDIT_SCRIPT, '--json'],
      { encoding: 'utf8', cwd: ROOT },
    );
    const current = JSON.parse(stdout) as {
      total: number;
      perFile: Record<string, number>;
      findings?: Array<{ file: string; line: number; key: string }>;
    };

    if (current.total > baseline.total) {
      const diff: Record<string, { baseline: number; current: number }> = {};
      const allFiles = new Set([
        ...Object.keys(baseline.perFile),
        ...Object.keys(current.perFile),
      ]);
      for (const f of allFiles) {
        const b = baseline.perFile[f] ?? 0;
        const c = current.perFile[f] ?? 0;
        if (c > b) {
          diff[f] = { baseline: b, current: c };
        }
      }
      // Location list (key + file:line only — never the secret value).
      const where = (current.findings ?? [])
        .map((x) => `  ${x.file}:${x.line} ${x.key}`)
        .join('\n');
      throw new Error(
        `Literal plaintext-secret count regressed.\n` +
          `Baseline total: ${baseline.total}\nCurrent total: ${current.total}\n\n` +
          `Files with increased counts:\n${Object.entries(diff)
            .map(
              ([f, d]) => `  ${f}: ${d.baseline} -> ${d.current} (+${d.current - d.baseline})`,
            )
            .join('\n')}\n\n` +
          (where ? `Leaks (REDACTED — key + location only):\n${where}\n\n` : '') +
          `A hardcoded secret VALUE was committed. FIX it — do not baseline it:\n` +
          `  • use a \${VAR} env interpolation (the value lives in Coolify Variables), or\n` +
          `  • migrate the secret to a Coolify file-mount (FOO_FILE=/run/secrets/foo)\n` +
          `    per docs/security/SECRETS_MANAGEMENT_INVESTIGATION_2026-05-20.md §5.1.\n` +
          `Only when a secret legitimately MOVED out of compose, regenerate the baseline:\n` +
          `  node scripts/audit/secrets-plaintext-env.mjs --write-baseline`,
      );
    }

    // success path — current ≤ baseline. Print a helpful note if it DROPPED
    // so the operator knows to regenerate the baseline (ratchet down).
    if (current.total < baseline.total) {
      console.warn(
        `[WP 3.7 ratchet] literal-secret count dropped ${baseline.total} -> ${current.total}.\n` +
          `Consider regenerating baseline: node scripts/audit/secrets-plaintext-env.mjs --write-baseline`,
      );
    }
    expect(current.total).toBeLessThanOrEqual(baseline.total);
  });
});
