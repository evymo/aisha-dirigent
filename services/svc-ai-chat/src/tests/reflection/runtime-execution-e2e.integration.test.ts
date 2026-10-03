/**
 * E3 EXECUTION e2e — proves the OpenClaw + Hermes RuntimeAdapters ACTUALLY EXECUTE,
 * not just get selected. The other suites verify SELECTION (which runtime) + adapter
 * logic with mocked transports; this one drives executeViaRuntime against REAL
 * backings:
 *   - openclaw → a real local HTTP server (the OpenClaw stub) — a true HTTP round-trip
 *     through postToOpenclaw, not a mock.
 *   - hermes   → the REAL evaluate_story_self RPC over the throwaway pg17 + PostgREST.
 *
 * Closes the honest gap: "live openclaw/hermes execution was unit-tested but never
 * exercised end-to-end." Run: npm run test:reflection:fullenv (skips offline).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Point the OpenClaw adapter's config at our local stub; keep the real postgrest
// URL/token (the fullenv harness exports them) so the Hermes adapter's rpc hits the
// throwaway PostgREST as service_role.
const { cfg } = vi.hoisted(() => ({
  cfg: {
    enableOpenclaw: true,
    openclawUrl: '',
    openclawApiKey: 'test-key',
    postgrestUrl: process.env.POSTGREST_URL ?? '',
    postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),
  },
}));
vi.mock('../../reflection/config.js', () => ({ reflectionConfig: cfg }));
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const RUN = BASE && TOKEN ? describe : describe.skip;

RUN('E3 execution e2e — OpenClaw (HTTP) + Hermes (DB) adapters really run', () => {
  let executeViaRuntime: typeof import('../../reflection/runtime/adapters.js')['executeViaRuntime'];
  let server: Server;
  const received: Array<{ path: string; auth: string | undefined; body: unknown }> = [];

  beforeAll(async () => {
    // Real local OpenClaw stub — records the request + returns an execution result.
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        received.push({ path: req.url ?? '', auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ output: 'openclaw executed the plan', steps: 3 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    cfg.openclawUrl = `http://127.0.0.1:${port}`;

    ({ executeViaRuntime } = await import('../../reflection/runtime/adapters.js'));
  });

  afterAll(() => {
    server?.close();
  });

  it('openclaw adapter performs a real HTTP dispatch and returns the executor result', async () => {
    const r = await executeViaRuntime('openclaw', {
      clow: { type: 'general', purpose: 'build the thing' },
      input: 'implement and deploy the feature',
    });
    expect(r.ok, JSON.stringify(r.detail)).toBe(true);
    expect(r.runtime).toBe('openclaw');
    expect(r.output).toBe('openclaw executed the plan');
    // The stub actually received an authenticated POST carrying the clow/task.
    expect(received.length).toBeGreaterThan(0);
    expect(received[0].auth).toBe('Bearer test-key');
    expect((received[0].body as { task?: { description?: string } }).task?.description).toContain('implement');
  });

  it('hermes adapter runs the REAL evaluate_story_self rail and returns a structured result', async () => {
    // evaluate_story_self is COALESCE-graceful: service_role bypasses the participant
    // gate and any story id yields a structured maturity verdict (no error) — enough
    // to prove the adapter→DB-rail execution path end-to-end.
    const r = await executeViaRuntime('hermes', {
      clow: { purpose: 'evaluate the closed story' },
      input: '',
      storyId: '00000000-0000-0000-0000-000000000001',
    });
    expect(r.ok, JSON.stringify(r.detail)).toBe(true);
    expect(r.runtime).toBe('hermes');
    // A real jsonb verdict came back from the DB (not empty / not an error).
    expect(r.output.length).toBeGreaterThan(0);
    expect(r.detail && Object.keys(r.detail).length).toBeGreaterThan(0);
  });

  it('an unavailable runtime still fails loud (no silent downgrade) even with real backings wired', async () => {
    await expect(executeViaRuntime('bogus_runtime', { clow: {}, input: 'x' })).rejects.toThrow(/No RuntimeAdapter/i);
  });
});
