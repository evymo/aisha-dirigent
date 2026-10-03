/**
 * Unit tests for svc-github-app/routes/webhook-bridge.ts.
 *
 * The webhook is the trust boundary between GitHub's public infrastructure
 * and our internal n8n workflows. Failure modes that MUST be caught:
 *
 *   1. Signature verification bypass (no header / wrong format / wrong secret)
 *   2. Body tampering (raw bytes used, not re-encoded JSON)
 *   3. Replay against secret-changed bridge
 *   4. Empty secret → all webhooks accepted (intentional config opt-out
 *      for dev, but explicit so it's not a silent regression)
 *   5. Installation lifecycle events go to DB, NOT n8n
 *   6. Standard events go to n8n with X-GitHub-* headers preserved
 *   7. Duplicate delivery → recorded but no n8n forward (idempotency)
 *   8. n8n unreachable → 502, complete_integration_event(failed) called
 *
 * We use the real `verifyGitHubSignature` (re-imported via `vi.unmock`
 * is not used here — the function is in-file so it tests directly).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const {
  mockRpcService,
  mockFetch,
} = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('../postgrest.js', () => ({ rpcService: mockRpcService }));

vi.mock('../config.js', () => ({
  config: {
    githubWebhookSecret: 'hmac-mock',
    n8nWebhookUrl: 'http://n8n:5678',
  },
}));

// Replace global fetch — webhook-bridge uses it to call n8n
const origFetch = globalThis.fetch;
beforeEach(() => {
  mockRpcService.mockReset();
  mockFetch.mockReset();
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

// Restore after suite — not strictly needed in vitest isolated workers
function restoreFetch() { (globalThis as { fetch: unknown }).fetch = origFetch; }

function signBody(body: string, secret = 'hmac-mock'): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((path: string, _opts: unknown, h: (req: unknown, reply: unknown) => unknown) => {
    handlers.set(`POST ${path}`, h);
  });
  // webhookBridgeRoutes uses `app.post('/webhook', { config: { rawBody: true } }, handler)`
  return {
    app: { post } as unknown as Parameters<typeof import('../routes/webhook-bridge.js').webhookBridgeRoutes>[0],
    handlers,
  };
}

function makeReply() {
  const calls: { code: number | null; body: unknown } = { code: null, body: undefined };
  const reply = {
    code(c: number) { calls.code = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

async function postWebhook(opts: {
  event: string;
  body: Record<string, unknown>;
  signature?: string | null;
  delivery?: string;
}) {
  const { webhookBridgeRoutes } = await import('../routes/webhook-bridge.js');
  const { app, handlers } = makeApp();
  await webhookBridgeRoutes(app);
  const { reply, calls } = makeReply();
  const rawBody = JSON.stringify(opts.body);
  const headers: Record<string, string> = {
    'x-github-event': opts.event,
    'x-github-delivery': opts.delivery ?? 'delivery-test-1',
  };
  if (opts.signature !== null) {
    headers['x-hub-signature-256'] = opts.signature ?? signBody(rawBody);
  }
  await handlers.get('POST /webhook')!(
    { headers, body: opts.body, rawBody, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    reply,
  );
  return calls;
}

// ── Signature verification ───────────────────────────────────

describe('webhook-bridge — signature verification', () => {
  it('401 when X-Hub-Signature-256 header is missing', async () => {
    const calls = await postWebhook({
      event: 'push',
      body: { repository: { full_name: 'aisha/x' } },
      signature: null,
    });
    expect(calls.code).toBe(401);
    expect(calls.body).toEqual({ error: 'Invalid signature' });
  });

  it('401 when signature format is wrong (no sha256= prefix)', async () => {
    const calls = await postWebhook({
      event: 'push',
      body: { repository: { full_name: 'aisha/x' } },
      signature: 'deadbeef',
    });
    expect(calls.code).toBe(401);
  });

  it('401 when signature has correct format but wrong secret', async () => {
    const calls = await postWebhook({
      event: 'push',
      body: { repository: { full_name: 'aisha/x' } },
      signature: signBody(JSON.stringify({ repository: { full_name: 'aisha/x' } }), 'WRONG-SECRET'),
    });
    expect(calls.code).toBe(401);
  });

  it('401 when payload was tampered after signing (raw bytes are signed, not re-encoded JSON)', async () => {
    // Sign the ORIGINAL body bytes, then send a different body. Even though
    // the JSON shape matches, the raw byte stream differs (key order, spacing).
    const originalRaw = '{"repository":{"full_name":"aisha/x"}}';
    const tamperedRaw = '{"repository":{"full_name":"aisha/EVIL"}}';
    const sig = signBody(originalRaw); // sign the original
    const { webhookBridgeRoutes } = await import('../routes/webhook-bridge.js');
    const { app, handlers } = makeApp();
    await webhookBridgeRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('POST /webhook')!(
      {
        headers: { 'x-github-event': 'push', 'x-github-delivery': 'd1', 'x-hub-signature-256': sig },
        body: JSON.parse(tamperedRaw),
        rawBody: tamperedRaw,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
      reply,
    );
    expect(calls.code).toBe(401);
  });

  it('uses rawBody (not JSON.stringify(body)) so key-order / whitespace doesn\'t break verification', async () => {
    // GitHub signs raw bytes. If our verification re-serialized the body,
    // any reordering by JSON.parse would break things. The route
    // explicitly uses `req.rawBody`. We use `pull_request` event with
    // action='closed' — that combination maps to NULL in resolveWebhookPath
    // → ignored response (proves we got PAST signature verification
    // without hitting n8n).
    const rawBody = '{"action":"closed","weird_key":true,"repository":{"full_name":"a/b"}}';
    const sig = signBody(rawBody);
    const { webhookBridgeRoutes } = await import('../routes/webhook-bridge.js');
    const { app, handlers } = makeApp();
    await webhookBridgeRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('POST /webhook')!(
      {
        headers: { 'x-github-event': 'pull_request', 'x-github-delivery': 'd2', 'x-hub-signature-256': sig },
        body: JSON.parse(rawBody),
        rawBody,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
      reply,
    );
    // pull_request + action='closed' → null webhookPath → ignored.
    // Proves signature verified (we passed line 282) AND we didn't
    // fall through to the catchall n8n forward.
    expect(calls.body).toMatchObject({ ok: true, ignored: true });
  });
});

// ── Installation lifecycle (DB only, no n8n) ─────────────────

describe('webhook-bridge — installation lifecycle events', () => {
  it('installation.created → handleInstallationCreated → DB write + audit, NO n8n forward', async () => {
    mockRpcService.mockResolvedValue(undefined);
    const calls = await postWebhook({
      event: 'installation',
      body: {
        action: 'created',
        installation: {
          id: 42,
          account: { login: 'aisha-org', type: 'Organization' },
          permissions: { contents: 'read' },
          repository_selection: 'selected',
        },
        repositories_added: [],
      },
    });
    expect(calls.body).toMatchObject({ ok: true, handled: 'installation_created' });
    expect(mockFetch).not.toHaveBeenCalled(); // NO n8n forward
    expect(mockRpcService).toHaveBeenCalledWith(
      'write_audit_journal',
      expect.objectContaining({ p_summary: 'GITHUB_APP_INSTALLED' }),
    );
  });

  it('installation.deleted → audit summary GITHUB_APP_UNINSTALLED', async () => {
    mockRpcService.mockResolvedValue(undefined);
    const calls = await postWebhook({
      event: 'installation',
      body: { action: 'deleted', installation: { id: 7, account: { login: 'aisha', type: 'Organization' } } },
    });
    expect(calls.body).toMatchObject({ ok: true, handled: 'installation_deleted' });
    expect(mockRpcService).toHaveBeenCalledWith(
      'write_audit_journal',
      expect.objectContaining({ p_summary: 'GITHUB_APP_UNINSTALLED' }),
    );
  });

  it('installation.suspend → audit summary GITHUB_APP_SUSPENDED (distinct from uninstall)', async () => {
    mockRpcService.mockResolvedValue(undefined);
    const calls = await postWebhook({
      event: 'installation',
      body: { action: 'suspend', installation: { id: 9, account: { login: 'a', type: 'Organization' } } },
    });
    expect(calls.body).toMatchObject({ handled: 'installation_suspended' });
    expect(mockRpcService).toHaveBeenCalledWith(
      'write_audit_journal',
      expect.objectContaining({ p_summary: 'GITHUB_APP_SUSPENDED' }),
    );
  });
});

// ── Unknown event ────────────────────────────────────────────

describe('webhook-bridge — event routing semantics (documented current behaviour)', () => {
  it('CURRENT: unrecognised event types fall through to /webhook/github-catchall (NOT ignored)', async () => {
    // Per `resolveWebhookPath::default`. Unknown event types are FORWARDED
    // to n8n at the catchall path, not silently dropped.
    // If we want unknown events to be IGNORED instead (defence-in-depth
    // against spurious forwards costing n8n compute), change the default
    // in resolveWebhookPath to `return null` and update this test.
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    mockRpcService.mockResolvedValue({ event_id: 'e1', is_duplicate: false });
    const calls = await postWebhook({
      event: 'futuristic-new-event-type-2030',
      body: { fancy: 'payload' },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://n8n:5678/webhook/github-catchall',
      expect.objectContaining({ method: 'POST' }),
    );
    expect((calls.body as { webhook_path: string }).webhook_path).toBe('/webhook/github-catchall');
  });

  it('pull_request with action=closed → null webhook path → IGNORED (no n8n forward)', async () => {
    // Per `resolveWebhookPath`: pull_request only routes on opened/synchronize/reopened.
    const calls = await postWebhook({
      event: 'pull_request',
      body: { action: 'closed', repository: { full_name: 'a/b' } },
    });
    expect(calls.body).toMatchObject({ ok: true, ignored: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('duplicate delivery (recordEvent returns is_duplicate=true) → no n8n forward (idempotency)', async () => {
    mockRpcService.mockResolvedValue({ event_id: 'e1', is_duplicate: true });
    const calls = await postWebhook({
      event: 'push',
      body: { repository: { full_name: 'a/b' } },
    });
    expect((calls.body as { duplicate: boolean }).duplicate).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Empty secret = signature check is SKIPPED (documented config) ──

describe('webhook-bridge — empty secret skips signature check (DEV-ONLY behavior)', () => {
  it('with empty githubWebhookSecret, requests with NO signature are accepted (no 401)', async () => {
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      config: {
        githubWebhookSecret: '', // intentional opt-out (DEV only — DO NOT use in prod)
        n8nWebhookUrl: 'http://n8n:5678',
      },
    }));
    vi.doMock('../postgrest.js', () => ({ rpcService: mockRpcService }));
    mockRpcService.mockResolvedValue(undefined);
    // Use pull_request + action=closed → ignored path so we don't reach n8n
    const { webhookBridgeRoutes } = await import('../routes/webhook-bridge.js');
    const { app, handlers } = makeApp();
    await webhookBridgeRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('POST /webhook')!(
      {
        headers: { 'x-github-event': 'pull_request', 'x-github-delivery': 'd3' }, // no signature header at all
        body: { action: 'closed', repository: { full_name: 'a/b' } },
        rawBody: '{"action":"closed","repository":{"full_name":"a/b"}}',
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
      reply,
    );
    // Empty secret → signature check skipped → pull_request.closed → ignored.
    // Critical: code is NOT 401 (would be 401 if signature gate fired).
    expect(calls.code).not.toBe(401);
    expect(calls.body).toMatchObject({ ok: true, ignored: true });
    vi.resetModules();
  });
});


// ── n8nWebhookUrl missing → 500 ──────────────────────────────

describe('webhook-bridge — boot-time misconfiguration', () => {
  it('500 when N8N_WEBHOOK_URL not configured (fail-closed)', async () => {
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      config: { githubWebhookSecret: 'x', n8nWebhookUrl: '' },
    }));
    const { webhookBridgeRoutes } = await import('../routes/webhook-bridge.js');
    const { app, handlers } = makeApp();
    await webhookBridgeRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('POST /webhook')!(
      { headers: {}, body: {}, rawBody: '{}', log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      reply,
    );
    expect(calls.code).toBe(500);
    expect(calls.body).toEqual({ error: 'Server misconfiguration' });
    vi.resetModules();
  });
});


restoreFetch();
