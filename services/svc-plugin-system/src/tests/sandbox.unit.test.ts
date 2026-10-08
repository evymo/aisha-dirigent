/**
 * Unit tests for svc-plugin-system sandbox primitives.
 *
 * svc-plugin-system loads third-party-authored plugins and exposes a
 * sandbox to them. The sandbox is the entire security boundary between
 * tenant-uploaded code and our infrastructure. Bugs here = arbitrary
 * RPC calls, arbitrary outbound network access, or unverified code
 * execution.
 *
 * Coverage:
 *   1. `validateCapabilities` — capability allowlist matching, including
 *      wildcards: `*`, `rpc.*`. Adversarial cases for prefix-matching attacks.
 *   2. `resolvePlugin` — only loadable (`canary` / `ga`) plugins are resolved
 *      (no draft / suspended / archived plugin execution).
 *   3. (odstraněno 2026-09-29) `createSandboxContext.fetch` — mrtvá cesta bez volajícího;
 *      síť pluginu hlídá broker `/sandbox/fetch` (broker-sandbox-politika, broker-fetch-redirect)
 *      nad `createSsrfGuard` z @aisha/security (ssrf.test.ts: přesná shoda, sufixový útok, schéma).
 *   4. `downloadAndVerifyArtifact` — SHA-256 verification. Tampered code
 *      MUST be rejected even if `Content-Length` matches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const { mockRpcService, mockRpcSandboxed, mockFetch } = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockRpcSandboxed: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('../postgrest.js', () => ({
  rpcService: mockRpcService,
  rpcSandboxed: mockRpcSandboxed,
}));

vi.mock('../config.js', () => ({
  config: {
    networkAllowlist: ['api.openai.com', 'githubusercontent.com'],
    aiGenerateUrl: 'http://svc-ai-chat:3011/generate',
    postgrestServiceToken: 'service-token',
    brokerTokenSecret: 'x'.repeat(32),
    pushServiceUrl: 'http://svc-push:3000',
    // artifactGuard() (sandbox.ts) reads these to build the plugin-artifact SSRF
    // guard. The store host is an RFC1918 IP literal on purpose: the guard resolves
    // the host via dns.lookup, and a numeric IP resolves offline with no network /
    // no dns mock, while allowInternalNetworks:true admits it — so the artifact
    // download tests below reach the (mocked) fetch and exercise SHA verification.
    s3Endpoint: 'http://10.0.0.1:9000',
    ssrfHostAllowlist: '',
  },
}));

beforeEach(() => {
  mockRpcService.mockReset();
  mockRpcSandboxed.mockReset();
  mockFetch.mockReset();
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

// ── validateCapabilities ─────────────────────────────────────

describe('validateCapabilities', () => {
  it('exact match passes', async () => {
    const { validateCapabilities } = await import('../sandbox.js');
    expect(validateCapabilities(['rpc.read'], ['rpc.read'])).toBe(true);
  });

  it('missing capability fails (no implicit grant)', async () => {
    const { validateCapabilities } = await import('../sandbox.js');
    expect(validateCapabilities(['rpc.read'], ['rpc.write'])).toBe(false);
  });

  it('wildcard "*" grants ALL capabilities (admin-style)', async () => {
    const { validateCapabilities } = await import('../sandbox.js');
    expect(validateCapabilities(['*'], ['rpc.read', 'rpc.write', 'fetch.external', 'kv.write']))
      .toBe(true);
  });

  it('namespace wildcard "rpc.*" grants any "rpc.<X>" capability', async () => {
    const { validateCapabilities } = await import('../sandbox.js');
    expect(validateCapabilities(['rpc.*'], ['rpc.read', 'rpc.write'])).toBe(true);
  });

  it('namespace wildcard "rpc.*" does NOT grant other namespaces', async () => {
    const { validateCapabilities } = await import('../sandbox.js');
    expect(validateCapabilities(['rpc.*'], ['kv.read'])).toBe(false);
  });

  it('namespace wildcard "rpc.*" does NOT grant capability that is a prefix-match attack', async () => {
    // "rpc.*" should ONLY match capabilities starting with "rpc." (with dot)
    // — not "rpcAttack" or "rpc-evil". The check is `req.startsWith(prefix + '.')`.
    const { validateCapabilities } = await import('../sandbox.js');
    expect(validateCapabilities(['rpc.*'], ['rpcAttack'])).toBe(false);
    expect(validateCapabilities(['rpc.*'], ['rpc'])).toBe(false); // bare 'rpc' has no dot suffix
  });

  it('multiple required capabilities — ALL must match (not any)', async () => {
    const { validateCapabilities } = await import('../sandbox.js');
    expect(validateCapabilities(['rpc.read', 'kv.read'], ['rpc.read', 'kv.write'])).toBe(false);
    expect(validateCapabilities(['rpc.read', 'kv.read', 'kv.write'], ['rpc.read', 'kv.write'])).toBe(true);
  });

  it('empty required list trivially passes (no capabilities needed)', async () => {
    const { validateCapabilities } = await import('../sandbox.js');
    expect(validateCapabilities([], [])).toBe(true);
    expect(validateCapabilities(['rpc.read'], [])).toBe(true);
  });

  it('plugin with no capabilities can\'t do anything', async () => {
    const { validateCapabilities } = await import('../sandbox.js');
    expect(validateCapabilities([], ['rpc.read'])).toBe(false);
  });

  it('case-sensitive: "RPC.READ" != "rpc.read" (no normalisation)', async () => {
    const { validateCapabilities } = await import('../sandbox.js');
    expect(validateCapabilities(['rpc.read'], ['RPC.READ'])).toBe(false);
  });
});

// ── resolvePlugin ────────────────────────────────────────────

describe('resolvePlugin', () => {
  it('returns loadable (canary/ga) plugin matching slug', async () => {
    // get_available_plugins only ever emits status IN ('canary','ga') and projects
    // the artifact identity as artifact_url / artifact_sha256 — mirror that shape.
    mockRpcService.mockResolvedValue([
      { slug: 'a', status: 'ga', name: 'A', version: '1', description: '', capabilities: [], artifact_url: 'http://10.0.0.1:9000/a.js', artifact_sha256: '' },
      { slug: 'b', status: 'canary', name: 'B', version: '1', description: '', capabilities: [], artifact_url: 'http://10.0.0.1:9000/b.js', artifact_sha256: '' },
    ]);
    const { resolvePlugin } = await import('../sandbox.js');
    const p = await resolvePlugin('a');
    expect(p?.slug).toBe('a');
  });

  it('never takes ctx.config from the catalog row (catalog is anon- and broker-callable)', async () => {
    // Negative probe: even if the catalog ever projected `config` again (the
    // pre-2026-09-15 SQL did — config_override with vendor credentials), the
    // runtime must not forward it into the sandbox payload.
    mockRpcService.mockResolvedValue([
      { slug: 'a', status: 'ga', name: 'A', version: '1', description: '', capabilities: [], artifact_url: 'http://10.0.0.1:9000/a.js', artifact_sha256: '', config: { apiToken: 'sonda-tajemstvi' } },
    ]);
    const { resolvePlugin } = await import('../sandbox.js');
    const p = await resolvePlugin('a');
    expect(p?.slug).toBe('a');
    expect(p?.config).toEqual({});
    expect(JSON.stringify(p)).not.toContain('sonda-tajemstvi');
  });

  it('returns null for inactive plugin (draft/suspended/archived must NOT execute)', async () => {
    mockRpcService.mockResolvedValue([
      { slug: 'a', status: 'suspended', name: 'A', version: '1', description: '', capabilities: [], entry: '', sha256: '' },
    ]);
    const { resolvePlugin } = await import('../sandbox.js');
    expect(await resolvePlugin('a')).toBeNull();
  });

  it('returns null when slug not found', async () => {
    mockRpcService.mockResolvedValue([]);
    const { resolvePlugin } = await import('../sandbox.js');
    expect(await resolvePlugin('missing')).toBeNull();
  });

  it('does NOT match similar-prefix slug ("ab" should not match request for "a")', async () => {
    mockRpcService.mockResolvedValue([
      { slug: 'abc', status: 'active', name: 'ABC', version: '1', description: '', capabilities: [], entry: '', sha256: '' },
    ]);
    const { resolvePlugin } = await import('../sandbox.js');
    expect(await resolvePlugin('a')).toBeNull();
  });
});

// ── downloadAndVerifyArtifact — SHA-256 ──────────────────────

describe('downloadAndVerifyArtifact', () => {
  it('accepts code matching expected SHA-256', async () => {
    const code = 'export default {};';
    const sha = createHash('sha256').update(code).digest('hex');
    mockFetch.mockResolvedValue(new Response(code, { status: 200 }));
    const { downloadAndVerifyArtifact } = await import('../sandbox.js');
    const out = await downloadAndVerifyArtifact('http://10.0.0.1:9000/p.js', sha);
    expect(out).toBe(code);
  });

  it('rejects code with mismatched SHA-256 (tampered artifact)', async () => {
    const code = 'export default { evil: true };';
    const wrongSha = 'a'.repeat(64);
    mockFetch.mockResolvedValue(new Response(code, { status: 200 }));
    const { downloadAndVerifyArtifact } = await import('../sandbox.js');
    await expect(downloadAndVerifyArtifact('http://10.0.0.1:9000/p.js', wrongSha))
      .rejects.toThrow('SHA-256 mismatch');
  });

  it('rejection message includes BOTH expected and actual hashes for diagnostic', async () => {
    const code = 'something';
    const wrongSha = 'deadbeef' + '0'.repeat(56);
    mockFetch.mockResolvedValue(new Response(code, { status: 200 }));
    const { downloadAndVerifyArtifact } = await import('../sandbox.js');
    try { await downloadAndVerifyArtifact('http://10.0.0.1:9000/x', wrongSha); } catch (e) {
      expect((e as Error).message).toContain('expected');
      expect((e as Error).message).toContain(wrongSha);
      const actualSha = createHash('sha256').update(code).digest('hex');
      expect((e as Error).message).toContain(actualSha);
    }
  });

  it('throws on non-200 download (HTTP-level failure)', async () => {
    mockFetch.mockResolvedValue(new Response('not found', { status: 404 }));
    const { downloadAndVerifyArtifact } = await import('../sandbox.js');
    await expect(downloadAndVerifyArtifact('http://10.0.0.1:9000/missing.js', 'x'))
      .rejects.toThrow('Failed to download');
  });

  it('case-sensitive SHA-256 (uppercase vs lowercase — strict compare)', async () => {
    const code = 'x';
    const lower = createHash('sha256').update(code).digest('hex'); // lowercase hex
    const upper = lower.toUpperCase();
    mockFetch.mockResolvedValue(new Response(code, { status: 200 }));
    const { downloadAndVerifyArtifact } = await import('../sandbox.js');
    // uppercase SHA in expected → mismatch (since createHash returns lowercase)
    await expect(downloadAndVerifyArtifact('http://10.0.0.1:9000/x', upper))
      .rejects.toThrow('SHA-256 mismatch');
  });
});
