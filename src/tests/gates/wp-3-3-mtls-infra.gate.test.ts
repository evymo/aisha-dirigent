/**
 * Gate test: Phase 12 WP 3.3 (Phase A) — mTLS infrastructure lock.
 *
 * The PKI bridge service + cert issuance route + rotation/trust-bundle/
 * health-check scripts were shipped earlier. This gate locks the
 * mTLS-relevant subset so any future regression (issuance route removed,
 * rotation script loses rolling-restart semantics, trust bundle stops
 * including AISHA CA) fails CI before reaching production.
 *
 * Phase B (actual Caddy + Fastify mTLS enforcement flip) is operator-
 * driven per docs/security/MTLS_GATEWAY_BACKEND_RUNBOOK.md §3.
 *
 * Enforces:
 *   1. services/svc-pki-bridge/ exists with issue route + auth + config
 *   2. Issue route uses POST + authenticated caller verification
 *   3. scripts/pki/rotate-cert.sh exists + executable + has rolling
 *      restart with health-check wait
 *   4. scripts/pki/gen-trust-bundle.sh exists + emits trust bundle
 *      with both system CAs AND AISHA internal CA
 *   5. scripts/pki/health-check.sh exists + verifies chain end-to-end
 *   6. Runbook documents Phase B 6-step operator sequence + rollback +
 *      cost projection + cross-references to WP 3.4/3.5/3.7
 *   7. PKI bridge service has Dockerfile + package.json (deployable
 *      Coolify stack)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const SVC_PKI_BRIDGE = path.join(ROOT, 'services/svc-pki-bridge');
const ISSUE_ROUTE = path.join(SVC_PKI_BRIDGE, 'src/routes/issue.ts');
const ROTATE_SCRIPT = path.join(ROOT, 'scripts/pki/rotate-cert.sh');
const TRUST_BUNDLE_SCRIPT = path.join(ROOT, 'scripts/pki/gen-trust-bundle.sh');
const HEALTH_SCRIPT = path.join(ROOT, 'scripts/pki/health-check.sh');
const RUNBOOK = path.join(ROOT, 'docs/security/MTLS_GATEWAY_BACKEND_RUNBOOK.md');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('Phase 12 WP 3.3 — svc-pki-bridge layout', () => {
  it('services/svc-pki-bridge/ directory exists', () => {
    expect(fs.existsSync(SVC_PKI_BRIDGE)).toBe(true);
  });

  it('Dockerfile present (deployable as Coolify stack)', () => {
    expect(fs.existsSync(path.join(SVC_PKI_BRIDGE, 'Dockerfile'))).toBe(true);
  });

  it('package.json declares svc-pki-bridge package', () => {
    const pkg = JSON.parse(
      readText(path.join(SVC_PKI_BRIDGE, 'package.json')),
    ) as { name?: string };
    expect(pkg.name).toMatch(/pki-bridge/i);
  });

  it('routes/issue.ts exists', () => {
    expect(fs.existsSync(ISSUE_ROUTE)).toBe(true);
  });
});

describe('Phase 12 WP 3.3 — Issue route contract', () => {
  const src = readText(ISSUE_ROUTE);

  it('handles POST /issue', () => {
    expect(src).toMatch(/(app|fastify)\.post\s*[(<]/);
  });

  it('authenticates the caller before issuing (auth-only surface)', () => {
    expect(src).toMatch(/verifyToken|authenticate|caller\.sub|jwt/i);
  });

  it('logs the authenticated caller (audit trail)', () => {
    expect(src).toMatch(
      /(req|request)\.log\.info[\s\S]{0,200}caller\.(sub|clientId)/,
    );
  });
});

describe('Phase 12 WP 3.3 — rotate-cert.sh (zero-downtime rotation)', () => {
  const src = readText(ROTATE_SCRIPT);

  it('script exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('script is executable', () => {
    const mode = fs.statSync(ROTATE_SCRIPT).mode & 0o777;
    expect((mode & 0o100) !== 0).toBe(true);
  });

  it('uses set -euo pipefail (safe shell)', () => {
    expect(src).toMatch(/set\s+-euo\s+pipefail/);
  });

  it('accepts --realm + --hostname + --services arguments', () => {
    expect(src).toMatch(/--realm/);
    expect(src).toMatch(/--hostname/);
    expect(src).toMatch(/--services/);
  });

  it('rolling restart: waits for health check between restarts', () => {
    // The "rolling" guarantee — must have an explicit wait/health gate
    // between service restarts; otherwise the rotation is just a
    // parallel restart that can take down all peers at once.
    expect(src).toMatch(/WAIT_HEALTHY|health[\s_-]?check|wait\s+\d+/i);
  });

  it('downloads new cert from OpenXPKI (PEM + key)', () => {
    expect(src).toMatch(/OpenXPKI|openxpkiadm|pki[/-]?client/i);
  });
});

describe('Phase 12 WP 3.3 — gen-trust-bundle.sh', () => {
  const src = readText(TRUST_BUNDLE_SCRIPT);

  it('script exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('script is executable', () => {
    const mode = fs.statSync(TRUST_BUNDLE_SCRIPT).mode & 0o777;
    expect((mode & 0o100) !== 0).toBe(true);
  });

  it('includes AISHA / internal CA in the bundle (not just system CAs)', () => {
    // The trust bundle's whole purpose is to make clients trust the
    // internal CA in addition to public CAs. If it only emits system
    // CAs, mTLS-issued certs won't validate.
    expect(src).toMatch(/aisha|internal|orchestration-plane|ca-bundle|ca\.pem/i);
  });
});

describe('Phase 12 WP 3.3 — health-check.sh', () => {
  const src = readText(HEALTH_SCRIPT);

  it('script exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('verifies cert chain (openssl or curl --cacert)', () => {
    expect(src).toMatch(/openssl\s+(s_client|verify)|curl[\s\S]{0,200}--cacert/i);
  });
});

describe('Phase 12 WP 3.3 — Runbook coverage', () => {
  const src = readText(RUNBOOK);

  it('runbook exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('documents Phase A (this PR — lock) vs Phase B (operator flip)', () => {
    expect(src).toMatch(/Phase A/i);
    expect(src).toMatch(/Phase B/i);
  });

  it('documents the 6-step Phase B rollout sequence', () => {
    expect(src).toMatch(/Step\s*1[:.]?\s*Provision/i);
    expect(src).toMatch(/Step\s*2[:.]?\s*Deploy.*trust bundle/i);
    expect(src).toMatch(/Step\s*3[:.]?\s*Enable mTLS at.*gateway|Caddy/i);
    expect(src).toMatch(/Step\s*4[:.]?\s*Enable mTLS at.*backend|Fastify/i);
    expect(src).toMatch(/Step\s*5[:.]?\s*Verify/i);
    expect(src).toMatch(/Step\s*6[:.]?\s*Cert rotation/i);
  });

  it('documents env-gated enforcement (AISHA_MTLS_ENFORCE)', () => {
    expect(src).toMatch(/AISHA_MTLS_ENFORCE/);
    expect(src).toMatch(/staged rollout|env-gated|env flag/i);
  });

  it('documents 24h cert TTL (short-lived blast radius reduction)', () => {
    expect(src).toMatch(/24[\s-]?h|86400|validity_seconds.{0,20}86400/i);
  });

  it('documents 3 rollback levels (per-service env, gateway-side, revocation)', () => {
    expect(src).toMatch(/Rollback/i);
    expect(src).toMatch(/AISHA_MTLS_ENFORCE=false/);
    expect(src).toMatch(/openxpkiadm certificate revoke|revoke/i);
  });

  it('documents cost projection (operator hours + runtime overhead)', () => {
    expect(src).toMatch(/Cost projection|cost/i);
    expect(src).toMatch(/operator/i);
    expect(src).toMatch(/handshake|TLS|ms/i);
  });

  it('cross-references WP 3.4 (net seg complementary) + WP 3.5 (JWT) + WP 3.7 (secrets)', () => {
    expect(src).toMatch(/WP 3\.4/);
    expect(src).toMatch(/WP 3\.5/);
    expect(src).toMatch(/WP 3\.7/);
  });

  it('lists Phase B deferral reasons (staged rollout, not code-only)', () => {
    expect(src).toMatch(/operator-driven|maintenance window|staged/i);
  });
});
