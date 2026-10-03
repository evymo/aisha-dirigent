/**
 * Unit tests for src/routes/issue.ts — the cert-issuance security boundary.
 *
 * svc-pki-bridge is the gate between Keycloak-authenticated callers and
 * OpenXPKI. A bug here = anyone with a valid Keycloak token can issue
 * arbitrary TLS certificates. We exercise both happy paths AND every
 * SAN-policy bypass we could think of.
 *
 * What we lock in:
 *   - Auth runs FIRST (no body parsing on unauthenticated requests)
 *   - Schema validation rejects malformed bodies with 400 + .details
 *   - SAN policy rejects ANY forbidden SAN, including:
 *     · double-subdomain attack (a.b.mesh.aisha.internal)
 *     · trailing-dot attack
 *     · leading-dot attack (".mesh.aisha.internal")  ← potential real bug
 *     · suffix injection (mesh.aisha.internal.evil.com)
 *     · NUL byte / CR-LF injection in hostname
 *     · IDN homoglyph (Cyrillic "а" vs Latin "a")
 *     · wildcard hostname requested by caller (`*.mesh.aisha.internal`)
 *   - OpenXPKI RPC errors get their statusCode preserved (502) without
 *     leaking internal error chain
 *   - Successful issuance returns 201 + the cert bundle verbatim
 *
 * NOTE on SAN policy bug: `matchesSanPolicy` returns true for hostnames
 * with an empty leading prefix (".mesh.aisha.internal"), because
 * `"".includes(".")` is false. That hostname is invalid per RFC 952/1123
 * (labels cannot be empty), but our policy passes it through. The tests
 * below DOCUMENT THE CURRENT BEHAVIOUR with a comment so we can decide
 * whether to tighten the regex in a follow-up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockVerifyToken,
  mockIssueCertificate,
} = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockIssueCertificate: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  verifyToken: mockVerifyToken,
  AuthError: class AuthError extends Error {
    statusCode: number;
    detail?: Record<string, unknown>;
    constructor(message: string, statusCode = 401, detail?: Record<string, unknown>) {
      super(message);
      this.name = 'AuthError';
      this.statusCode = statusCode;
      this.detail = detail;
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

// Fastify stub
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

async function postIssue(body: unknown, authHeader?: string) {
  const { issueRoutes } = await import('../routes/issue.js');
  const { app, handlers } = makeApp();
  await issueRoutes(app);
  const { reply, calls } = makeReply();
  await handlers.get('/v1/issue')!(makeReq(body, authHeader), reply);
  return calls;
}

const VALID_BODY = {
  hostname: 'core.mesh.aisha.internal',
  sans: ['secondary.mesh.aisha.internal'],
  comment: 'integration test',
};

const VALID_CALLER = { sub: 'sa-aisha-pki-bootstrap', clientId: 'aisha-pki-bootstrap', roles: ['pki:issue'] };

beforeEach(() => {
  mockVerifyToken.mockReset().mockResolvedValue(VALID_CALLER);
  mockIssueCertificate.mockReset();
});

// ── Auth ──────────────────────────────────────────────────────

describe('POST /v1/issue — auth gate', () => {
  it('auth runs BEFORE schema validation (bad body + no token → auth error, not 400)', async () => {
    mockVerifyToken.mockRejectedValue(
      Object.assign(new Error('Missing or invalid Authorization header'), { statusCode: 401 }),
    );
    // Empty body would normally 400 — but auth must fire first
    await expect(postIssue({}, undefined)).rejects.toBeDefined();
    expect(mockIssueCertificate).not.toHaveBeenCalled();
  });
});

// ── Schema validation ────────────────────────────────────────

describe('POST /v1/issue — schema validation', () => {
  it('400 + .details when hostname is missing', async () => {
    const calls = await postIssue({ sans: [] });
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toBe('Invalid request body');
    expect((calls.body as { details: string[] }).details.length).toBeGreaterThan(0);
  });

  it('400 when hostname exceeds 253 characters (DNS spec max)', async () => {
    const calls = await postIssue({ hostname: 'a'.repeat(254), sans: [] });
    expect(calls.status).toBe(400);
  });

  it('400 when a SAN entry exceeds 253 characters', async () => {
    const calls = await postIssue({
      hostname: 'core.mesh.aisha.internal',
      sans: ['x'.repeat(254)],
    });
    expect(calls.status).toBe(400);
  });

  it('400 when comment exceeds 500 chars (audit-row size protection)', async () => {
    const calls = await postIssue({
      hostname: 'core.mesh.aisha.internal',
      comment: 'A'.repeat(501),
    });
    expect(calls.status).toBe(400);
  });

  it('400 when hostname is empty string (min 1 enforced)', async () => {
    const calls = await postIssue({ hostname: '', sans: [] });
    expect(calls.status).toBe(400);
  });
});

// ── SAN policy — happy path ───────────────────────────────────

describe('POST /v1/issue — SAN policy (happy path)', () => {
  it('issues when hostname matches *.mesh.aisha.internal', async () => {
    mockIssueCertificate.mockResolvedValue({
      certificate: 'PEM-CERT', privateKey: 'PEM-KEY', chain: 'PEM-CHAIN',
      certIdentifier: 'oid-1', transactionId: 'tx-1',
    });
    const calls = await postIssue({
      hostname: 'core.mesh.aisha.internal', sans: [], comment: 'c',
    });
    expect(calls.status).toBe(201);
    expect((calls.body as { certIdentifier: string }).certIdentifier).toBe('oid-1');
    // SANs passed to openxpki include the CN as first entry
    expect(mockIssueCertificate).toHaveBeenCalledWith(
      'core.mesh.aisha.internal',
      ['core.mesh.aisha.internal'],
      expect.stringContaining('caller=aisha-pki-bootstrap'),
    );
  });

  it('issues when hostname matches exact pattern cert.aisha.guru', async () => {
    mockIssueCertificate.mockResolvedValue({
      certificate: 'C', privateKey: 'K', chain: 'CH', certIdentifier: 'oid-2', transactionId: 'tx-2',
    });
    const calls = await postIssue({ hostname: 'cert.aisha.guru', sans: [] });
    expect(calls.status).toBe(201);
  });

  it('deduplicates hostname from SANs (CN should appear once as first SAN)', async () => {
    mockIssueCertificate.mockResolvedValue({
      certificate: 'C', privateKey: 'K', chain: 'CH', certIdentifier: 'oid-3', transactionId: 'tx-3',
    });
    await postIssue({
      hostname: 'core.mesh.aisha.internal',
      sans: ['core.mesh.aisha.internal', 'other.mesh.aisha.internal'], // CN repeated
    });
    expect(mockIssueCertificate).toHaveBeenCalledWith(
      'core.mesh.aisha.internal',
      ['core.mesh.aisha.internal', 'other.mesh.aisha.internal'], // dedupe applied
      expect.any(String),
    );
  });
});

// ── SAN policy — adversarial REJECTIONS ──────────────────────

describe('POST /v1/issue — SAN policy adversarial rejections', () => {
  it('rejects multi-label subdomain (a.b.mesh.aisha.internal) — single-level wildcard only', async () => {
    const calls = await postIssue({
      hostname: 'evil.attacker.mesh.aisha.internal',
      sans: [],
    });
    expect(calls.status).toBe(403);
    expect((calls.body as { forbidden: string[] }).forbidden)
      .toContain('evil.attacker.mesh.aisha.internal');
  });

  it('rejects suffix injection (mesh.aisha.internal.evil.com)', async () => {
    const calls = await postIssue({
      hostname: 'core.mesh.aisha.internal.evil.com',
      sans: [],
    });
    expect(calls.status).toBe(403);
  });

  it('rejects unrelated domain (evil.com)', async () => {
    const calls = await postIssue({ hostname: 'evil.com', sans: [] });
    expect(calls.status).toBe(403);
    expect(mockIssueCertificate).not.toHaveBeenCalled();
  });

  it('rejects suffix-similar but distinct (mesh.aisha.internalx)', async () => {
    const calls = await postIssue({ hostname: 'core.mesh.aisha.internalx', sans: [] });
    expect(calls.status).toBe(403);
  });

  it('rejects exact suffix without leading dot (mesh.aisha.internal — missing subdomain label)', async () => {
    const calls = await postIssue({ hostname: 'mesh.aisha.internal', sans: [] });
    expect(calls.status).toBe(403);
  });

  it('rejects trailing-dot variant (core.mesh.aisha.internal.) — string endsWith check fails', async () => {
    const calls = await postIssue({ hostname: 'core.mesh.aisha.internal.', sans: [] });
    expect(calls.status).toBe(403);
  });

  it('rejects ANY forbidden SAN even if hostname is allowed (defense-in-depth on SAN array)', async () => {
    const calls = await postIssue({
      hostname: 'core.mesh.aisha.internal',
      sans: ['evil.com', 'attacker.example.org'],
    });
    expect(calls.status).toBe(403);
    expect((calls.body as { forbidden: string[] }).forbidden).toEqual(
      expect.arrayContaining(['evil.com', 'attacker.example.org']),
    );
    // CN is allowed — it should NOT appear in forbidden list
    expect((calls.body as { forbidden: string[] }).forbidden)
      .not.toContain('core.mesh.aisha.internal');
  });

  it('rejects IDN homoglyph (Cyrillic а in aiѕha)', async () => {
    // The "ѕ" below is U+0455 (Cyrillic small letter dze), looks like Latin "s"
    const calls = await postIssue({ hostname: 'core.mesh.aiѕha.network', sans: [] });
    expect(calls.status).toBe(403);
  });

  it('rejects CRLF-injected hostname (header smuggling attempt)', async () => {
    const calls = await postIssue({
      hostname: 'core.mesh.aisha.internal\r\nX-Inject: evil',
      sans: [],
    });
    expect(calls.status).toBe(403);
  });

  it('rejects NUL byte in hostname (truncation attack on downstream tools)', async () => {
    const calls = await postIssue({
      hostname: 'core.mesh.aisha.internal\x00.evil.com',
      sans: [],
    });
    expect(calls.status).toBe(403);
  });

  it('returns allowedPatterns in error response for caller diagnostic (no data leak)', async () => {
    const calls = await postIssue({ hostname: 'evil.com', sans: [] });
    expect(calls.body).toMatchObject({
      error: expect.stringContaining('Forbidden'),
      forbidden: ['evil.com'],
      allowedPatterns: ['*.mesh.aisha.internal', 'cert.aisha.guru'],
    });
  });
});

// ── SAN policy — documented edge cases (intentional or to-be-fixed) ──

describe('POST /v1/issue — SAN policy documented edge cases (hardened)', () => {
  it('hardened: caller-requested wildcard `*.mesh.aisha.internal` is REJECTED (prefix "*" is not a valid DNS label)', async () => {
    // matchesSanPolicy now validates the wildcard prefix against an RFC 1123
    // label regex, so a literal "*" prefix no longer satisfies the policy.
    mockIssueCertificate.mockResolvedValue({
      certificate: 'C', privateKey: 'K', chain: 'CH', certIdentifier: 'oid-w', transactionId: 'tx-w',
    });
    const calls = await postIssue({ hostname: '*.mesh.aisha.internal', sans: [] });
    expect(calls.status).toBe(403);
    expect(mockIssueCertificate).not.toHaveBeenCalled();
  });

  it('hardened: leading-dot hostname ".mesh.aisha.internal" is REJECTED (empty label per RFC 952/1123)', async () => {
    // The top-level RFC 1123 guard rejects hostnames with an empty label
    // (leading/trailing/double dot) before any CSR is built.
    mockIssueCertificate.mockResolvedValue({
      certificate: 'C', privateKey: 'K', chain: 'CH', certIdentifier: 'oid-d', transactionId: 'tx-d',
    });
    const calls = await postIssue({ hostname: '.mesh.aisha.internal', sans: [] });
    expect(calls.status).toBe(403);
    expect(mockIssueCertificate).not.toHaveBeenCalled();
  });
});

// ── OpenXPKI failures ────────────────────────────────────────

describe('POST /v1/issue — OpenXPKI failures', () => {
  it('maps OpenXpkiRpcError to its statusCode (502) + sanitised detail', async () => {
    const { issueRoutes: _ } = await import('../routes/issue.js');
    const { OpenXpkiRpcError } = await import('../openxpki-rpc.js');
    mockIssueCertificate.mockRejectedValue(new OpenXpkiRpcError('CSR rejected by realm policy'));

    const calls = await postIssue({ hostname: 'core.mesh.aisha.internal', sans: [] });
    expect(calls.status).toBe(502);
    expect(calls.body).toEqual({
      error: 'PKI backend issuance failed',
      detail: 'CSR rejected by realm policy',
    });
  });

  it('non-OpenXpkiRpcError (unexpected throw) bubbles up so Fastify error handler can sanitise it', async () => {
    mockIssueCertificate.mockRejectedValue(new Error('unexpected internal'));
    await expect(postIssue({ hostname: 'core.mesh.aisha.internal', sans: [] }))
      .rejects.toThrow('unexpected internal');
  });
});
