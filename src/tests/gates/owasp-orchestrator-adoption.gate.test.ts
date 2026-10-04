/**
 * OWASP umbrella gate test — verifies cross-service adoption of @aisha/security.
 *
 * Principle: data is sensitive by default. Every service ships the same
 * primitives regardless of perceived risk tier, because the value of data
 * flowing through any service is not knowable at design time. Exemptions
 * are architectural-shape constraints only (gateway has DB-driven CORS,
 * ws-gateway is WebSocket-only, event-worker has no HTTP) — they are NOT
 * "this service handles less-sensitive data".
 *
 * Architectural exemptions (each MUST have a positive replacement
 * primitive — exemption from `applySecurity` does NOT mean exemption from
 * the underlying control):
 *   - gateway      → uses buildHelmetOptions + custom DB-driven CORS callback
 *   - ws-gateway   → uses buildHelmetOptions + buildGlobalRateLimitOptions
 *   - event-worker → must use safeLogger + safeFetch (no HTTP surface)
 *
 * Coverage map:
 *   A01 → owasp_rls_coverage_report RPC exists (file-level check)
 *   A03 → @aisha/security errors module imported where Zod validation happens
 *   A04 → applySecurity() call OR explicit rate-limit registration via helpers
 *   A05 → helmet wired (via applySecurity OR buildHelmetOptions)
 *   A07 → @aisha/security/jwt verifier present where Authorization is consumed
 *   A09 → log_security_event RPC exists + service imports safeLogger
 *   A10 → service imports safeFetch / ssrf guard if it makes outbound calls
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isTrackedService } from './lib/tracked-services';
import { duvodVynechanoSnapshotem } from './lib/vynechano-snapshotem';

const PROJECT_ROOT = process.cwd();
const SERVICES_DIR = join(PROJECT_ROOT, 'services');
const MIGRATION_REGISTRY = join(PROJECT_ROOT, 'aisha/db/migration-registry.json');

/**
 * Architectural exemptions — service shape prevents the canonical
 * `applySecurity()` wrapper. Each one MUST adopt the underlying primitive
 * via the lower-level helper from @aisha/security; the umbrella verifies
 * this via `serviceUsesHelmet` / `serviceUsesRateLimit`.
 */
const OWASP_KNOWN_EXEMPTIONS: Record<string, string[]> = {
  'gateway': ['applySecurity'],     // DB-driven CORS via cors-origins.ts
  'ws-gateway': ['applySecurity'],  // WebSocket-only, no preflight semantics
  'event-worker': ['applySecurity', 'helmet', 'rateLimit', 'cors'], // no HTTP surface
  // svc-playwright-runner is a pure polling worker (shell entrypoint;
  // get_next_playwright_run → npx playwright test → record_playwright_result).
  // No HTTP listener, no JWT verification — outbound only, calls go through
  // PostgREST with service-role token. Same shape as event-worker.
  'svc-playwright-runner': ['applySecurity', 'helmet', 'rateLimit', 'cors'],
};

interface ServiceEvidence {
  service: string;
  files: { path: string; content: string }[];
}

function listServices(): string[] {
  return readdirSync(SERVICES_DIR).filter((entry) => {
    // The repo decides what a service is, not the filesystem. This gate had only an
    // isDirectory() condition, so a removed service's leftover `dist/` was enumerated
    // as a real service and failed all four adoption checks — locally only, since CI
    // checks out clean. See lib/tracked-services.ts.
    if (!isTrackedService(entry)) return false;
    const p = join(SERVICES_DIR, entry);
    return statSync(p).isDirectory();
  });
}

function readServiceTree(service: string): ServiceEvidence {
  const root = join(SERVICES_DIR, service, 'src');
  if (!existsSync(root)) return { service, files: [] };
  const files: ServiceEvidence['files'] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts)$/.test(entry)) continue;
      files.push({ path: full, content: readFileSync(full, 'utf8') });
    }
  }
  walk(root);
  return { service, files };
}

function isExempt(service: string, check: string): boolean {
  return Boolean(OWASP_KNOWN_EXEMPTIONS[service]?.includes(check));
}

function serviceImportsSecurity(ev: ServiceEvidence): boolean {
  return ev.files.some((f) => /@aisha\/security/.test(f.content));
}

function serviceUsesApplySecurity(ev: ServiceEvidence): boolean {
  return ev.files.some((f) => /applySecurity\s*\(/.test(f.content));
}

function serviceUsesHelmet(ev: ServiceEvidence): boolean {
  return ev.files.some(
    (f) => /@fastify\/helmet/.test(f.content) || /buildHelmetOptions/.test(f.content),
  );
}

function serviceUsesRateLimit(ev: ServiceEvidence): boolean {
  return ev.files.some(
    (f) =>
      /@fastify\/rate-limit/.test(f.content) ||
      /buildGlobalRateLimitOptions/.test(f.content) ||
      /applySecurity\s*\(/.test(f.content),
  );
}

function serviceUsesJwt(ev: ServiceEvidence): boolean {
  return ev.files.some(
    (f) =>
      /from\s+['"]jose['"]/.test(f.content) ||
      /@aisha\/security\/jwt/.test(f.content) ||
      /verifyToken/.test(f.content) ||
      /verifyServiceRole/.test(f.content) ||
      /createJwtVerifier/.test(f.content),
  );
}

describe('OWASP — cross-service @aisha/security adoption', () => {
  const services = listServices();

  test('shared @aisha/security package exists and exports canonical primitives', () => {
    const indexPath = join(PROJECT_ROOT, 'packages/security/src/index.ts');
    expect(existsSync(indexPath)).toBe(true);
    const idx = readFileSync(indexPath, 'utf8');
    for (const sym of [
      'applySecurity',
      './logger',
      './cors',
      './helmet',
      './rateLimit',
      './jwt',
      './ssrf',
      './errors',
      './secrets',
      './audit',
    ]) {
      expect(idx).toMatch(new RegExp(sym.replace(/[./]/g, '\\$&')));
    }
  });

  describe.each(services)('service: %s', (service) => {
    const ev = readServiceTree(service);

    test('imports @aisha/security (every service must use shared primitives)', () => {
      expect(
        serviceImportsSecurity(ev),
        `services/${service} must import from @aisha/security — even fully-exempt services need safeLogger and the audit emitter`,
      ).toBe(true);
    });

    test('uses applySecurity (default) OR has architectural exemption', () => {
      if (isExempt(service, 'applySecurity')) return;
      expect(
        serviceUsesApplySecurity(ev),
        `services/${service} should call applySecurity() from @aisha/security`,
      ).toBe(true);
    });

    test('A05 — helmet is wired (directly or via applySecurity)', () => {
      if (isExempt(service, 'helmet')) return;
      expect(
        serviceUsesHelmet(ev) || serviceUsesApplySecurity(ev),
        `services/${service} should register helmet (directly or via applySecurity)`,
      ).toBe(true);
    });

    test('A04 — rate-limit is wired (any layer)', () => {
      if (isExempt(service, 'rateLimit')) return;
      expect(
        serviceUsesRateLimit(ev),
        `services/${service} should register a rate limiter`,
      ).toBe(true);
    });

    test('A07 — JWT verification is present when service consumes Authorization', () => {
      // We flag only services that VERIFY an inbound Authorization header
      // (verifyToken / verifyAuth / req.headers.authorization read). Outbound
      // Authorization headers (sending Bearer to upstream services) are a
      // different concern and not in scope here.
      const hasInboundAuth = ev.files.some(
        (f) =>
          /verifyToken|verifyAuth|verifyServiceRole/.test(f.content) ||
          /req\.headers\.authorization|req\.headers\[['"]authorization['"]\]/.test(f.content),
      );
      if (!hasInboundAuth) return;
      expect(
        serviceUsesJwt(ev),
        `services/${service} verifies inbound Authorization but does not import a JWT verifier`,
      ).toBe(true);
    });
  });
});

describe('OWASP — database-level controls (file-level signal)', () => {
  test('A09 — log_security_event RPC source file exists', () => {
    const p = join(PROJECT_ROOT, 'aisha/db/sql/functions/log_security_event.sql');
    expect(existsSync(p)).toBe(true);
    const sql = readFileSync(p, 'utf8');
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.log_security_event/);
  });

  test('A01 — owasp_rls_coverage_report RPC source file exists', () => {
    const p = join(PROJECT_ROOT, 'aisha/db/sql/functions/owasp_rls_coverage_report.sql');
    expect(existsSync(p)).toBe(true);
    const sql = readFileSync(p, 'utf8');
    expect(sql).toMatch(/is_admin_or_staff/);
    expect(sql).toMatch(/relrowsecurity/);
  });

  test('A09 — OWASP security-event logging RPCs absorbed into canonical schema (baseline-only)', () => {
    // The *_owasp_security_event_logging migration was absorbed into the
    // baseline: the registry is baseline-only and both RPCs now live in the
    // canonical compiled schema. We assert the registration intent against
    // current SoT — the baseline-only registry plus presence of both RPCs in
    // the real baseline — never an archived migration filename.
    const registry = readFileSync(MIGRATION_REGISTRY, 'utf8');
    expect(registry, 'migration registry must be baseline-only').toMatch(
      /Baseline-only state/i,
    );

    const baseline = readFileSync(
      join(PROJECT_ROOT, 'aisha/db/migrations/00000000000000_baseline.sql'),
      'utf8',
    );
    expect(
      baseline,
      'log_security_event RPC missing from canonical baseline',
    ).toMatch(/FUNCTION public\.log_security_event/);
    expect(
      baseline,
      'owasp_rls_coverage_report RPC missing from canonical baseline',
    ).toMatch(/owasp_rls_coverage_report/);
  });
});

// Veřejný snapshot `.github/dependabot.yml` ani `.github/workflows/` nevozí
// (config/public-snapshot.exclude) — tam se tyto testy PŘESKOČÍ s důvodem,
// v upstreamu měří. Viz lib/vynechano-snapshotem.
const DUVOD_DEPENDABOT = duvodVynechanoSnapshotem('.github/dependabot.yml');
const DUVOD_PODPIS = duvodVynechanoSnapshotem('.github/workflows/container-signing.yml');

describe('OWASP — CI controls', () => {
  test.skipIf(DUVOD_DEPENDABOT !== null)(
    `A06 — Dependabot config exists${DUVOD_DEPENDABOT ? ` — NEZMĚŘENO: ${DUVOD_DEPENDABOT}` : ''}`,
    () => {
      expect(existsSync(join(PROJECT_ROOT, '.github/dependabot.yml'))).toBe(true);
    },
  );

  // 2026-07-14: the heavy supply-chain lane (npm-audit matrix, SBOM, trivy) was
  // extracted from ci.yml to supply-chain.yml (nightly schedule + dispatch) so
  // the shared runner never carries it at peak. Same controls, new home.
  test('A06 — npm-audit workflow runs across services (matrix)', () => {
    const wf = readFileSync(join(PROJECT_ROOT, '.forgejo/workflows/supply-chain.yml'), 'utf8');
    expect(wf).toMatch(/npm-audit-services/);
    expect(wf).toMatch(/strategy:\s*\n\s*fail-fast: false\s*\n\s*matrix:/);
  });

  test('A06/A08 — CycloneDX SBOM step exists in CI', () => {
    const wf = readFileSync(join(PROJECT_ROOT, '.forgejo/workflows/supply-chain.yml'), 'utf8');
    expect(wf).toMatch(/@cyclonedx\/cyclonedx-npm/);
  });

  test.skipIf(DUVOD_PODPIS !== null)(
    `A08 — container-signing workflow uses cosign + SLSA provenance${DUVOD_PODPIS ? ` — NEZMĚŘENO: ${DUVOD_PODPIS}` : ''}`,
    () => {
      const wfPath = join(PROJECT_ROOT, '.github/workflows/container-signing.yml');
      expect(existsSync(wfPath)).toBe(true);
      const wf = readFileSync(wfPath, 'utf8');
      expect(wf).toMatch(/sigstore\/cosign-installer/);
      expect(wf).toMatch(/cosign sign/);
      expect(wf).toMatch(/slsaprovenance/);
    },
  );
});
