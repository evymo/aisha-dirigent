/**
 * POST /reflect/runs/:id/resume-batch — unit tests.
 *
 * Verifies the route's contract with WF_BATCH_RESUMER:
 *   1. Service-role auth required (401 otherwise).
 *   2. Calls resumeAfterBatch(runId) — fire-and-respond (202 immediately).
 *   3. Returns { accepted: true, run_id } shape n8n expects.
 *   4. Errors during async orchestration are logged but don't bubble to
 *      the HTTP response (n8n already has the row in DB and audit).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

// ── Mock auth + orchestrator + checkpointer ──────────────────────────────────
// Reference the mocked AuthError class inside the test code without
// runtime `require()` (forbidden by @typescript-eslint/no-require-imports).
class MockAuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const verifyServiceRoleMock = vi.hoisted(() => vi.fn());

vi.mock('../../auth.js', () => ({
  verifyServiceRole: verifyServiceRoleMock,
  AuthError: MockAuthError,
}));

const runWorkflowMock = vi.hoisted(() => vi.fn());
const resumeAfterApprovalMock = vi.hoisted(() => vi.fn());
const resumeAfterBatchMock = vi.hoisted(() => vi.fn());

vi.mock('../../reflection/orchestrator.js', () => ({
  runWorkflow: runWorkflowMock,
  resumeAfterApproval: resumeAfterApprovalMock,
  resumeAfterBatch: resumeAfterBatchMock,
}));

const loadRunMock = vi.hoisted(() => vi.fn());
vi.mock('../../reflection/checkpointer.js', () => ({
  loadRun: loadRunMock,
}));

// ── Helper: build a fresh Fastify app with the reflect routes mounted ────────
async function buildApp() {
  const { reflectRoutes } = await import('../../routes/reflect.js');
  const app = Fastify({ logger: false });
  await app.register(reflectRoutes);
  return app;
}

beforeEach(() => {
  verifyServiceRoleMock.mockReset();
  runWorkflowMock.mockReset();
  resumeAfterApprovalMock.mockReset();
  resumeAfterBatchMock.mockReset();
  loadRunMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /reflect/runs/:id/resume-batch', () => {
  it('returns 401 when service-role header is missing', async () => {
    verifyServiceRoleMock.mockImplementation(() => {
      throw new MockAuthError('Missing Authorization', 401);
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/reflect/runs/00000000-0000-0000-0000-000000000001/resume-batch',
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('Unauthorized');
    expect(resumeAfterBatchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 202 + accepted=true + run_id, and fires resumeAfterBatch async', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    // Slow-resolving promise so we can prove route returns BEFORE orchestrator finishes
    let resolveRun!: () => void;
    resumeAfterBatchMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRun = resolve;
      }),
    );

    const app = await buildApp();
    const runId = '11111111-1111-1111-1111-111111111111';
    const res = await app.inject({
      method: 'POST',
      url: `/reflect/runs/${runId}/resume-batch`,
      headers: { authorization: 'Bearer test-service-token' },
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.accepted).toBe(true);
    expect(body.run_id).toBe(runId);

    // Orchestrator was invoked with the run_id from the URL
    expect(resumeAfterBatchMock).toHaveBeenCalledTimes(1);
    expect(resumeAfterBatchMock).toHaveBeenCalledWith(runId);

    // Resolve the pending promise so vi doesn't leak — proves async fire-and-respond
    resolveRun();
    await app.close();
  });

  it('does NOT propagate orchestrator errors to HTTP response (fire-and-forget)', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    resumeAfterBatchMock.mockRejectedValueOnce(new Error('checkpoint corrupted'));

    const app = await buildApp();
    const runId = '22222222-2222-2222-2222-222222222222';
    const res = await app.inject({
      method: 'POST',
      url: `/reflect/runs/${runId}/resume-batch`,
      headers: { authorization: 'Bearer test-service-token' },
      payload: {},
    });

    // 202 returned even though orchestrator will throw — caller (n8n) sees
    // accepted, the real failure lands in svc-ai-chat logs + audit_journal
    // via persist_batch_result_and_resume RPC.
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).accepted).toBe(true);

    // Wait a tick so the rejected promise has a chance to be caught by our
    // .catch handler in the route (prevents unhandledRejection warning).
    await new Promise((r) => setImmediate(r));
    await app.close();
  });
});
