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
 *   3. `createSandboxContext.fetch` — network allowlist enforcement.
 *      Adversarial: subdomain-only-match, exact-host-match, blocked-host
 *      rejection. AbortSignal.timeout enforced.
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

// ── createSandboxContext.fetch — network allowlist ───────────

describe('createSandboxContext.fetch — network allowlist', () => {
  it('allows exact-host match (api.openai.com)', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const { createSandboxContext } = await import('../sandbox.js');
    const ctx = createSandboxContext('test-plugin', 'user-1', []);
    await ctx.fetch('https://api.openai.com/v1/models');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('allows subdomain of allowed host (raw.githubusercontent.com)', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 200 }));
    const { createSandboxContext } = await import('../sandbox.js');
    const ctx = createSandboxContext('test-plugin', 'user-1', []);
    await ctx.fetch('https://raw.githubusercontent.com/file.txt');
    expect(mockFetch).toHaveBeenCalled();
  });

  it('rejects blocked host (evil.com)', async () => {
    const { createSandboxContext } = await import('../sandbox.js');
    const ctx = createSandboxContext('test-plugin', 'user-1', []);
    await expect(ctx.fetch('https://evil.com/exfil')).rejects.toThrow("'evil.com' is not allowed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects suffix-attack host (githubusercontent.com.evil.com)', async () => {
    const { createSandboxContext } = await import('../sandbox.js');
    const ctx = createSandboxContext('test-plugin', 'user-1', []);
    await expect(ctx.fetch('https://githubusercontent.com.evil.com/x'))
      .rejects.toThrow('not allowed');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects prefix-attack host (Xapi.openai.com)', async () => {
    const { createSandboxContext } = await import('../sandbox.js');
    const ctx = createSandboxContext('test-plugin', 'user-1', []);
    await expect(ctx.fetch('https://Xapi.openai.com/v1/x')).rejects.toThrow('not allowed');
  });

  it('rejects non-HTTPS URL even when host is allowlisted', async () => {
    const { createSandboxContext } = await import('../sandbox.js');
    const ctx = createSandboxContext('test-plugin', 'user-1', []);
    await expect(ctx.fetch('http://api.openai.com:1337/x')).rejects.toThrow("'http:' URLs is not allowed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('attaches AbortSignal.timeout(10s) — caller cannot disable', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 200 }));
    const { createSandboxContext } = await import('../sandbox.js');
    const ctx = createSandboxContext('p', 'u', []);
    // Pass a deliberately-disabled signal — the route must override
    await ctx.fetch('https://api.openai.com/x', { signal: undefined as unknown as AbortSignal });
    const init = mockFetch.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ── createSandboxContext.fetch — empty allowlist = closed ────

describe('createSandboxContext.fetch — empty allowlist', () => {
  it('with networkAllowlist=[], all outbound network access is denied', async () => {
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      config: {
        networkAllowlist: [],
        aiGenerateUrl: 'http://svc-ai-chat:3011/generate',
        postgrestServiceToken: 'service-token',
        brokerTokenSecret: 'x'.repeat(32),
        pushServiceUrl: 'http://svc-push:3000',
        // Keep the config complete (mirrors the top-level mock): this doMock
        // outlives its resetModules() and would otherwise leak an s3Endpoint-less
        // config into the downloadAndVerifyArtifact block (artifactGuard → new URL).
        s3Endpoint: 'http://10.0.0.1:9000',
        ssrfHostAllowlist: '',
      },
    }));
    const { createSandboxContext } = await import('../sandbox.js');
    const ctx = createSandboxContext('p', 'u', []);
    await expect(ctx.fetch('https://evil.com/anything')).rejects.toThrow('No network destinations are allowed');
    expect(mockFetch).not.toHaveBeenCalled();
    vi.resetModules();
  });
});

// ── createSandboxContext.llm — governed route ────────────────

describe('createSandboxContext.llm', () => {
  it('routes plugin LLM prompts through the governed AISHA generator', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ text: 'ok' }), { status: 200 }));
    const { createSandboxContext } = await import('../sandbox.js');
    const ctx = createSandboxContext('test-plugin', 'user-1', []);

    await expect(ctx.llm('summarize this', { model: 'gpt-4o-mini', maxTokens: 123 })).resolves.toBe('ok');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://svc-ai-chat:3011/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer service-token' }),
      }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.constraints).toMatchObject({
      source: 'plugin_sandbox',
      plugin_slug: 'test-plugin',
      requested_model: 'gpt-4o-mini',
    });
    expect(body.max_tokens).toBe(123);
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
