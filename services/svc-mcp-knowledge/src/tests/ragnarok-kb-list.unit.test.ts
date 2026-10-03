/**
 * Unit tests for the /ragnarok/upload {action:"list"} proxy seam (NG-10).
 *
 * Upstream defect we compensate for AT THE SEAM (packages/insight is a git
 * submodule — not patchable from this repo): on a fresh/empty Elasticsearch
 * (zero `{index}_*` indices) ES omits the `aggregations` response key, and
 * `VectorStore.get_kb_ids` (ragnarok/vector_db.py) reads `res["aggregations"]`
 * unguarded → KeyError('aggregations') → FastAPI 500 with detail
 * "Unhandled exception occurred: 'aggregations'". Its sibling
 * `get_project_ids` guards this exact case and returns [].
 *
 * Contract proven here:
 *   1. empty-ES 500 signature      → 200 with correct-empty list (NOT a fallback:
 *                                    an empty store has zero knowledge bases)
 *   2. any OTHER 500               → loud 502 (genuine ES failure must surface)
 *   3. 404 "Data record not found" → 200 correct-empty (pre-existing behavior)
 *   4. 404 with any other detail   → loud 502
 *   5. healthy upstream list       → normalized rows pass through
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let Fastify: typeof import('fastify').default | null = null;
try {
  Fastify = (await import('fastify')).default;
} catch {
  Fastify = null;
}
const describeIfFastify = Fastify ? describe : describe.skip;

const MockAuthError = vi.hoisted(
  () =>
    class MockAuthError extends Error {
      statusCode: number;
      constructor(statusCode: number, message: string) {
        super(message);
        this.statusCode = statusCode;
      }
    },
);

const verifyTokenMock = vi.hoisted(() => vi.fn());
const verifyServiceRoleMock = vi.hoisted(() => vi.fn());
const isAdminOrStaffMock = vi.hoisted(() => vi.fn());
vi.mock('../auth.js', () => ({
  verifyToken: verifyTokenMock,
  verifyServiceRole: verifyServiceRoleMock,
  isAdminOrStaff: isAdminOrStaffMock,
  AuthError: MockAuthError,
}));

vi.mock('../config.js', () => ({
  config: {
    ragnarokUrl: 'http://ragnarok.test:9696',
    ragnarokApiKey: 'test-ragnarok-key',
    ragnarokDefaultProjectId: 'aisha',
  },
}));

import { ragnarokRoutes } from '../routes/ragnarok.js';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function buildApp() {
  const app = Fastify!();
  await app.register(ragnarokRoutes);
  return app;
}

async function postList(app: Awaited<ReturnType<typeof buildApp>>) {
  return app.inject({
    method: 'POST',
    url: '/ragnarok/upload',
    headers: { authorization: 'Bearer service-role-token', 'content-type': 'application/json' },
    payload: { action: 'list', project_id: 'proj-1' },
  });
}

describeIfFastify('/ragnarok/upload action=list (KB list proxy seam)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    // Caller is service-role: user-token verification fails, service-role passes.
    verifyTokenMock.mockRejectedValue(new MockAuthError(401, 'no user token'));
    verifyServiceRoleMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the empty-ES KeyError(aggregations) 500 to a correct-empty list', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { detail: "Unhandled exception occurred: 'aggregations'" }),
    );

    const app = await buildApp();
    const res = await postList(app);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, data: [], knowledge_bases: [] });
  });

  it('keeps every other 500 loud (502) — genuine ES failure must surface', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, {
        detail: 'Unhandled exception occurred: ConnectionError to elasticsearch:9200',
      }),
    );

    const app = await buildApp();
    const res = await postList(app);

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Ragnarok list failed: 500' });
  });

  it('does not treat a 500 without the exact signature as empty (no broad matching)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { detail: 'aggregations timed out' }));

    const app = await buildApp();
    const res = await postList(app);

    expect(res.statusCode).toBe(502);
  });

  it('maps 404 "Data record not found" to a correct-empty list (existing contract)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { detail: 'Data record proj-1 not found' }),
    );

    const app = await buildApp();
    const res = await postList(app);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, data: [], knowledge_bases: [] });
  });

  it('keeps other 404s loud (502)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { detail: 'route not found' }));

    const app = await buildApp();
    const res = await postList(app);

    expect(res.statusCode).toBe(502);
  });

  it('passes a healthy upstream list through, normalized', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, ['kb-a', 'kb-b']));

    const app = await buildApp();
    const res = await postList(app);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      data: ['kb-a', 'kb-b'],
      knowledge_bases: [
        { kb_id: 'kb-a', project_id: 'proj-1' },
        { kb_id: 'kb-b', project_id: 'proj-1' },
      ],
    });
    // and the proxy called ragnarok with the expected URL + auth
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(calledUrl)).toBe('http://ragnarok.test:9696/knowledge_base/?project_id=proj-1');
    expect((calledInit.headers as Record<string, string>).Authorization).toBe('test-ragnarok-key');
  });
});
