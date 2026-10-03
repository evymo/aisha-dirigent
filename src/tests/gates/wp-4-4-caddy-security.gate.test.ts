/**
 * Gate test: Phase 12 WP 4.4 — Caddy hardening invariants.
 *
 * Enforces:
 *   1. infra/caddy/Caddyfile.d/security-headers.caddy exists with 7 headers
 *      (HSTS preload, X-Frame-Options DENY, nosniff, Referrer-Policy,
 *       Permissions-Policy, X-Permitted-Cross-Domain-Policies, COOP)
 *   2. HSTS max-age >= 31536000 (1 year) — hstspreload.org minimum
 *   3. HSTS includes `includeSubDomains` + `preload` directives
 *   4. infra/caddy/Caddyfile.aisha-defaults exists with HTTP/3 + brotli
 *   5. Runbook documents deploy procedure + rollback + verify steps
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const HEADERS = path.join(ROOT, 'infra/caddy/Caddyfile.d/security-headers.caddy');
const DEFAULTS = path.join(ROOT, 'infra/caddy/Caddyfile.aisha-defaults');
const RUNBOOK = path.join(ROOT, 'docs/security/CADDY_HARDENING_RUNBOOK.md');

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 4.4 — security-headers.caddy snippet', () => {
  it('snippet file exists', () => {
    expect(fs.existsSync(HEADERS)).toBe(true);
  });

  it('declares a `security-headers` named block (importable)', () => {
    expect(readOrEmpty(HEADERS)).toMatch(/\(security-headers\)\s*\{/);
  });

  it('sets HSTS with max-age >= 1 year + includeSubDomains + preload', () => {
    const src = readOrEmpty(HEADERS);
    const m = src.match(/Strict-Transport-Security\s+"max-age=(\d+).*?"/);
    expect(m, 'HSTS header missing').not.toBeNull();
    const maxAge = Number(m![1]);
    expect(maxAge, 'HSTS max-age must be >= 31536000 (1y)').toBeGreaterThanOrEqual(31536000);
    expect(src).toMatch(/includeSubDomains/);
    expect(src).toMatch(/preload/);
  });

  it('sets X-Frame-Options DENY', () => {
    expect(readOrEmpty(HEADERS)).toMatch(/X-Frame-Options\s+"DENY"/);
  });

  it('sets X-Content-Type-Options nosniff', () => {
    expect(readOrEmpty(HEADERS)).toMatch(/X-Content-Type-Options\s+"nosniff"/);
  });

  it('sets Referrer-Policy strict-origin-when-cross-origin', () => {
    expect(readOrEmpty(HEADERS)).toMatch(
      /Referrer-Policy\s+"strict-origin-when-cross-origin"/,
    );
  });

  it('sets Permissions-Policy denying geo/cam/mic/payment/usb', () => {
    const src = readOrEmpty(HEADERS);
    expect(src).toMatch(/Permissions-Policy/);
    expect(src).toMatch(/geolocation=\(\)/);
    expect(src).toMatch(/camera=\(\)/);
    expect(src).toMatch(/microphone=\(\)/);
    expect(src).toMatch(/payment=\(\)/);
  });

  it('sets X-Permitted-Cross-Domain-Policies none (legacy browsers)', () => {
    expect(readOrEmpty(HEADERS)).toMatch(
      /X-Permitted-Cross-Domain-Policies\s+"none"/,
    );
  });

  it('sets Cross-Origin-Opener-Policy same-origin', () => {
    expect(readOrEmpty(HEADERS)).toMatch(
      /Cross-Origin-Opener-Policy\s+"same-origin"/,
    );
  });
});

describe('Phase 12 WP 4.4 — Caddyfile.aisha-defaults', () => {
  it('defaults file exists', () => {
    expect(fs.existsSync(DEFAULTS)).toBe(true);
  });

  it('enables HTTP/3 via `protocols h1 h2 h3`', () => {
    expect(readOrEmpty(DEFAULTS)).toMatch(/protocols\s+h1\s+h2\s+h3/);
  });

  it('enables compression: zstd + brotli + gzip (in preference order)', () => {
    expect(readOrEmpty(DEFAULTS)).toMatch(/encode\s+zstd\s+br\s+gzip/);
  });

  it('imports the Caddyfile.d snippet directory', () => {
    expect(readOrEmpty(DEFAULTS)).toMatch(
      /import\s+\/etc\/caddy\/Caddyfile\.d/,
    );
  });

  it('documents max_header_size for Coolify+NetBird+auth chain', () => {
    expect(readOrEmpty(DEFAULTS)).toMatch(/max_header_size/);
  });
});

describe('Phase 12 WP 4.4 — runbook', () => {
  it('CADDY_HARDENING_RUNBOOK.md exists', () => {
    expect(fs.existsSync(RUNBOOK)).toBe(true);
  });

  it('documents deploy + verify + rollback sections', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/Deploy procedure/i);
    expect(md).toMatch(/Verify/i);
    expect(md).toMatch(/Rollback/i);
  });

  it('explains HSTS preload one-way nature + 1-year cache', () => {
    expect(readOrEmpty(RUNBOOK)).toMatch(/preload.*one-way|one-way.*preload/i);
  });

  it('warns about UDP 443 firewall for HTTP/3', () => {
    expect(readOrEmpty(RUNBOOK)).toMatch(/UDP\s+443/);
  });
});
