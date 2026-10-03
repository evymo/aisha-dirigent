/**
 * REMEDIATION (S3-pki-san-policy) — behavioral spec for the SAN-policy
 * hardening of svc-pki-bridge's cert-issuance boundary (src/routes/issue.ts).
 *
 * This is the EXECUTABLE SPEC for the fix. It asserts the CORRECT (post-fix)
 * contract, so it is RED at HEAD and GREEN once matchesSanPolicy is hardened.
 *
 * Threat: a compromised (but validly-authenticated) Keycloak token can request
 * a cert for a caller-controlled hostname/SAN. `matchesSanPolicy` must therefore
 * reject anything that is not a well-formed RFC 1123 hostname within an allowed
 * pattern. The current `*.`-glob check only tests that the wildcard PREFIX
 * contains no dot — so it accepts a literal "*" prefix, an EMPTY prefix
 * (leading dot), and prefixes carrying CR/LF/NUL control bytes, all of which
 * satisfy `!prefix.includes('.')`.
 *
 * Each payload below currently makes matchesSanPolicy() return true → the route
 * proceeds to issue (201). The hardened policy must reject them (403). The
 * companion file routes-issue.unit.test.ts intentionally DOCUMENTS the buggy
 * 201 behaviour ("current behaviour" cases) — this file is the counter-spec
 * that flips those to the secure contract. When the fix lands, that companion's
 * two "documented edge case" tests are expected to be updated too.
 *
 * Fix contract (what makes this go GREEN):
 *   - A caller-requested wildcard ("*.mesh.aisha.internal") is rejected.
 *   - A leading-dot / empty-label host (".mesh.aisha.internal") is rejected.
 *   - Any host/SAN containing CR, LF, or NUL is rejected.
 *   - More generally: each label matches RFC 1123 ([a-z0-9] with internal
 *     hyphens), so control bytes and "*" never validate.
 *   - Legitimate hosts within the allowed patterns still issue (201) — the
 *     fix must not over-reject.
 *
 * Run:
 *   cd services/svc-pki-bridge && npx vitest run src/tests/san-policy-hardening.unit.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerifyToken, mockIssueCertificate } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockIssueCertificate: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  verifyToken: mockVerifyToken,
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 401) {
      super(message);
      this.name = 'AuthError';
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('../openxpki-rpc.js', () => ({
  issueCertificate: mockIssueCertificate,
  OpenXpkiRpcError: class OpenXpkiRpcError extends Error {
    readonly statusCode = 502;
    constructor(message: string) { super(message); this.name = 'OpenXpkiRpcError'; }
  },
}));

vi.mock('../config.js', () => ({
  config: {
    allowedSanPatterns: ['*.mesh.aisha.internal', 'cert.aisha.guru'],
    keyAlgorithm: 'P-384',
    openxpkiRpcUrl: 'http://pki-webui:80/rpc',
    openxpkiRealm: 'orchestration-plane',
    certProfile: 'tls-server',
  },
}));

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((path: string, handler: (req: unknown, reply: unknown) => unknown) =>
    handlers.set(path, handler));
  return { app: { post } as unknown as Parameters<typeof import('../routes/issue.js').issueRoutes>[0], handlers };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

function makeReq(body: unknown, authHeader = 'Bearer good-token') {
  return {
    headers: { authorization: authHeader },
    body,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

async function postIssue(body: unknown) {
  const { issueRoutes } = await import('../routes/issue.js');
  const { app, handlers } = makeApp();
  await issueRoutes(app);
  const { reply, calls } = makeReply();
  await handlers.get('/v1/issue')!(makeReq(body), reply);
  return calls;
}

const VALID_CALLER = { sub: 'sa-aisha-pki-bootstrap', clientId: 'aisha-pki-bootstrap', roles: ['pki:issue'] };

beforeEach(() => {
  mockVerifyToken.mockReset().mockResolvedValue(VALID_CALLER);
  mockIssueCertificate.mockReset().mockResolvedValue({
    certificate: 'C', privateKey: 'K', chain: 'CH', certIdentifier: 'oid', transactionId: 'tx',
  });
});

// ── The class of SAN-policy bypasses that must be REJECTED (403) ──────
//
// Every entry here currently returns 201 at HEAD because matchesSanPolicy's
// `!prefix.includes('.')` guard accepts a "*" prefix, an empty prefix, and
// prefixes carrying control bytes. This is the defect this test locks down.
const MUST_REJECT: Array<[label: string, hostname: string]> = [
  ['caller-requested wildcard', '*.mesh.aisha.internal'],
  ['leading-dot / empty label', '.mesh.aisha.internal'],
  ['CR/LF injection (suffix preserved)', 'e\r\nvil.mesh.aisha.internal'],
  ['bare CR in label', 'e\rvil.mesh.aisha.internal'],
  ['bare LF in label', 'e\nvil.mesh.aisha.internal'],
  ['NUL truncation (suffix preserved)', 'e\x00vil.mesh.aisha.internal'],
];

describe('svc-pki-bridge SAN policy — hardening (post-fix contract)', () => {
  for (const [label, hostname] of MUST_REJECT) {
    it(`rejects ${label} as hostname → 403, no issuance`, async () => {
      const calls = await postIssue({ hostname, sans: [] });
      expect(calls.status).toBe(403);
      expect(mockIssueCertificate).not.toHaveBeenCalled();
    });

    it(`rejects ${label} smuggled via SANs array → 403, no issuance`, async () => {
      const calls = await postIssue({ hostname: 'core.mesh.aisha.internal', sans: [hostname] });
      expect(calls.status).toBe(403);
      expect(mockIssueCertificate).not.toHaveBeenCalled();
    });
  }

  // ── Guard: the fix must NOT over-reject legitimate hosts ────────────
  it('still issues for a well-formed host in the wildcard pattern (201)', async () => {
    const calls = await postIssue({ hostname: 'core.mesh.aisha.internal', sans: [] });
    expect(calls.status).toBe(201);
  });

  it('still issues for the exact-match pattern cert.aisha.guru (201)', async () => {
    const calls = await postIssue({ hostname: 'cert.aisha.guru', sans: [] });
    expect(calls.status).toBe(201);
  });

  it('still issues for a hyphenated RFC1123 label (201)', async () => {
    const calls = await postIssue({ hostname: 'core-01.mesh.aisha.internal', sans: [] });
    expect(calls.status).toBe(201);
  });
});
