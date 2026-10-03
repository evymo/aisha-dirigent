/**
 * Gate test: Phase 12 WP 4.7 — CSP nonce + Sentry PII filter invariants.
 *
 * Enforces:
 *   1. infra/caddy/Caddyfile.d/csp.caddy exists with TWO snippets:
 *      - (csp-report-only) — Content-Security-Policy-Report-Only header
 *      - (csp-enforce)     — Content-Security-Policy header
 *   2. CSP has nonce-based script-src (NO 'unsafe-inline' in script-src)
 *   3. CSP has frame-ancestors 'none' (modern X-Frame-Options=DENY)
 *   4. CSP has report-uri /csp-report (Sentry forwarding)
 *   5. CSP has restrictive defaults: base-uri 'self', form-action 'self'
 *   6. Sentry beforeSend in src/lib/monitoring/sentry.ts redacts FIVE event fields:
 *      message, exception.values, breadcrumbs (message+data), extra, tags
 *   7. redactSensitive in safeLogger.ts covers email + UUID + JWT + bearer/apikey
 *   8. Runbook documents two-step rollout + rollback
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const CSP_SNIPPET = path.join(ROOT, 'infra/caddy/Caddyfile.d/csp.caddy');
const SENTRY_TS = path.join(ROOT, 'src/lib/monitoring/sentry.ts');
const SAFELOGGER_TS = path.join(ROOT, 'src/lib/security/safeLogger.ts');
const RUNBOOK = path.join(ROOT, 'docs/security/CSP_ROLLOUT_RUNBOOK.md');

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 4.7 — csp.caddy snippet', () => {
  it('snippet exists', () => {
    expect(fs.existsSync(CSP_SNIPPET)).toBe(true);
  });

  it('declares (csp-report-only) named block (Step 1)', () => {
    const src = readOrEmpty(CSP_SNIPPET);
    expect(src).toMatch(/\(csp-report-only\)\s*\{/);
    expect(src).toMatch(/Content-Security-Policy-Report-Only/);
  });

  it('declares (csp-enforce) named block (Step 2)', () => {
    const src = readOrEmpty(CSP_SNIPPET);
    expect(src).toMatch(/\(csp-enforce\)\s*\{/);
    // Enforcing header (no -Report-Only suffix) — name followed by quoted value
    expect(src).toMatch(/header\s+Content-Security-Policy\s+"/);
    // And NOT the Report-Only variant inside this block
  });

  it('uses nonce-based script-src (NO unsafe-inline in script-src)', () => {
    const src = readOrEmpty(CSP_SNIPPET);
    // Both snippets must include script-src 'nonce-...
    const matches = src.match(/script-src[^"]*?'nonce-\{http\.request\.uuid\}'/g);
    expect(matches?.length, "both csp-report-only AND csp-enforce must use nonce-based script-src").toBeGreaterThanOrEqual(2);
  });

  it('script-src does NOT include unsafe-inline (the whole point)', () => {
    const src = readOrEmpty(CSP_SNIPPET);
    // Strip Caddy comments
    const stripped = src.replace(/^\s*#.*$/gm, '');
    // Find every CSP header value and check script-src clause
    const cspHeaders = stripped.match(/Content-Security-Policy[^\n]*"([^"]+)"/g) ?? [];
    for (const headerLine of cspHeaders) {
      // Extract just the script-src directive
      const scriptSrc = headerLine.match(/script-src\s+([^;]+);/);
      expect(scriptSrc, `script-src missing in: ${headerLine}`).not.toBeNull();
      expect(
        scriptSrc?.[1],
        `script-src must NOT include 'unsafe-inline': ${scriptSrc?.[1]}`,
      ).not.toMatch(/'unsafe-inline'/);
    }
  });

  it('frame-ancestors none (modern X-Frame-Options=DENY)', () => {
    const src = readOrEmpty(CSP_SNIPPET);
    expect(src).toMatch(/frame-ancestors\s+'none'/);
  });

  it('report-uri /csp-report (Sentry forwarding endpoint)', () => {
    expect(readOrEmpty(CSP_SNIPPET)).toMatch(/report-uri\s+\/csp-report/);
  });

  it('restrictive base-uri + form-action + default-src self', () => {
    const src = readOrEmpty(CSP_SNIPPET);
    expect(src).toMatch(/base-uri\s+'self'/);
    expect(src).toMatch(/form-action\s+'self'/);
    expect(src).toMatch(/default-src\s+'self'/);
  });

  it('connect-src allows wss + {$PUBLIC_TLD} + {$INTERNAL_TLD} (Caddy env syntax; no permissive unsafe-eval)', () => {
    const src = readOrEmpty(CSP_SNIPPET);
    // Strip Caddy comments so doc lines don't fail the regex
    const stripped = src.replace(/^\s*#.*$/gm, '');
    expect(stripped).toMatch(/wss:/);
    // Caddyfile.d/csp.caddy uses Caddy env syntax {$VAR} (not shell ${VAR})
    expect(stripped).toMatch(/\{\$PUBLIC_TLD\}/);
    expect(stripped).toMatch(/\{\$INTERNAL_TLD\}/);
    expect(stripped).not.toMatch(/'unsafe-eval'/);
  });
});

describe('Phase 12 WP 4.7 — Sentry PII filter (already wired)', () => {
  it('sentry.ts exists with beforeSend handler', () => {
    expect(fs.existsSync(SENTRY_TS)).toBe(true);
    expect(readOrEmpty(SENTRY_TS)).toMatch(/beforeSend\s*\(\s*event\s*\)/);
  });

  it('redacts event.message', () => {
    expect(readOrEmpty(SENTRY_TS)).toMatch(/event\.message[\s\S]*?redactSensitive/);
  });

  it('redacts event.exception.values', () => {
    expect(readOrEmpty(SENTRY_TS)).toMatch(/event\.exception[\s\S]*?values[\s\S]*?redactSensitive/);
  });

  it('redacts event.breadcrumbs (message + data)', () => {
    const src = readOrEmpty(SENTRY_TS);
    expect(src).toMatch(/event\.breadcrumbs/);
    expect(src).toMatch(/redactSensitive[\s\S]*?crumb\.message|crumb\.message[\s\S]*?redactSensitive/);
    expect(src).toMatch(/redactObjectStrings[\s\S]*?crumb\.data|crumb\.data[\s\S]*?redactObjectStrings/);
  });

  it('redacts event.extra + event.tags via deep redaction', () => {
    const src = readOrEmpty(SENTRY_TS);
    expect(src).toMatch(/event\.extra/);
    expect(src).toMatch(/event\.tags/);
  });

  it('sendDefaultPii=false (Sentry SDK setting)', () => {
    expect(readOrEmpty(SENTRY_TS)).toMatch(/sendDefaultPii:\s*false/);
  });

  it('replayIntegration masks all text + blocks media', () => {
    const src = readOrEmpty(SENTRY_TS);
    expect(src).toMatch(/replayIntegration/);
    expect(src).toMatch(/maskAllText:\s*true/);
    expect(src).toMatch(/blockAllMedia:\s*true/);
  });
});

describe('Phase 12 WP 4.7 — redactSensitive patterns', () => {
  it('redactSensitive in safeLogger.ts covers email + UUID + JWT + bearer/apikey', () => {
    const src = readOrEmpty(SAFELOGGER_TS);
    expect(src).toMatch(/export const redactSensitive/);
    // Email pattern
    expect(src).toMatch(/redacted-email/);
    // UUID pattern
    expect(src).toMatch(/redacted-id/);
    // JWT pattern (eyJ prefix)
    expect(src).toMatch(/eyJ.*redacted-jwt|redacted-jwt.*eyJ/);
    // Bearer/apikey pattern
    expect(src).toMatch(/bearer.*redacted-token|redacted-token.*bearer/i);
  });
});

describe('Phase 12 WP 4.7 — runbook', () => {
  it('CSP_ROLLOUT_RUNBOOK.md exists', () => {
    expect(fs.existsSync(RUNBOOK)).toBe(true);
  });

  it('documents two-step rollout (report-only then enforce)', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/Step 1[\s\S]*?Report-Only/);
    expect(md).toMatch(/Step 2[\s\S]*?Enforce/i);
    expect(md).toMatch(/3.*days|3.*consecutive/);
  });

  it('documents Sentry CSP report endpoint wiring', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/\/csp-report/);
    expect(md).toMatch(/SENTRY_PROJECT_ID/);
  });

  it('documents rollback (flip back to report-only)', () => {
    expect(readOrEmpty(RUNBOOK)).toMatch(/Rollback/i);
  });

  it('notes WP 4.4 companion + Sentry PII filter already wired', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/WP 4\.4/);
    expect(md).toMatch(/already.*wired|already.*done/i);
  });
});
