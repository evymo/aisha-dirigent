/**
 * POST /chat — AITG output guard on the AUTHENTICATED response path.
 *
 * Before this fix only the public-chat n8n path ran withAitgGuardOrRefuse; the
 * authenticated /chat surface emitted model output unguarded. These tests drive
 * a full /chat turn with the workflow engine mocked to return (a) an output that
 * trips the AITG-APP-01 prompt-injection classifier and (b) a benign output, and
 * assert the violating response is REPLACED by a safe refusal (aitg_blocked=true)
 * while clean responses pass through untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const USER_ID = '11111111-1111-1111-1111-111111111111';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'route-test-hs256';
  // aitgRunRecordSchema requires build_sha ≥ 7 chars (prod passes a real GIT_SHA);
  // without it the runner no-ops before transport and the fetch observation below
  // would see nothing.
  process.env.GIT_SHA = 'deadbeefcafe';
});

vi.mock('../../auth.js', () => {
  class AuthError extends Error {
    constructor(public statusCode: number, message: string) {
      super(message);
      this.name = 'AuthError';
    }
  }
  return { verifyToken: vi.fn(), AuthError };
});

vi.mock('../../postgrest.js', () => ({ rpcService: vi.fn(), rpcUser: vi.fn() }));

vi.mock('@aisha/llm-dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aisha/llm-dispatch')>();
  return {
    ...actual,
    getRegistry: () => ({
      hasAnyAvailableBackend: async () => true,
      diagnostics: async () => [],
    }),
  };
});

// The LLM/workflow engine is not under test — pin its output so the guard's
// verdict is the only variable.
const engineOutput = { content: '' };
vi.mock('../../lib/workflowEngine.js', () => ({
  DEFAULT_CHAT_WORKFLOW: { nodes: {} },
  loadWorkflow: vi.fn(async () => ({ graph: { nodes: {} }, workflowId: null, name: 'test-wf' })),
  createWorkflowEngine: vi.fn(() => ({
    execute: vi.fn(async () => ({
      content: engineOutput.content,
      category: 'Else',
      specialistUsed: 'main_agent',
      totalTokensInput: 5,
      totalTokensOutput: 7,
      toolIterationsUsed: 0,
      nodesExecuted: 1,
      criticRevised: false,
      provenanceSummary: undefined,
      preflightWarnings: [],
      costSummary: undefined,
    })),
  })),
}));

// Keep the pure helpers real; stub only the DB/LLM-touching resolvers.
vi.mock('../../lib/orchestrationBridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orchestrationBridge.js')>();
  return {
    ...actual,
    routeViaAisha: vi.fn(async () => null),
    enrichWithAishaContext: vi.fn(async () => null),
    chooseExecutionStrategy: vi.fn(async () => null),
    kickOffReflectionWorkflow: vi.fn(async () => null),
    selectOptimalModel: vi.fn(async () => ({
      model: 'test-model',
      complexity: 'simple' as const,
      reason: 'pinned-for-test',
      source: 'fallback' as const,
      contextWindow: null,
      maxOutputTokens: null,
    })),
  };
});

import { chatRoutes } from '../../routes/chat.js';
import { verifyToken } from '../../auth.js';
import { rpcService, rpcUser } from '../../postgrest.js';

const verifyTokenMock = verifyToken as unknown as ReturnType<typeof vi.fn>;
const rpcServiceMock = rpcService as unknown as ReturnType<typeof vi.fn>;
const rpcUserMock = rpcUser as unknown as ReturnType<typeof vi.fn>;

async function buildApp() {
  const app = Fastify();
  await app.register(chatRoutes);
  await app.ready();
  return app;
}

function installHappyPathRpcs() {
  rpcUserMock.mockImplementation(async (fn: string) => {
    switch (fn) {
      case 'get_chat_access_level':
        return { access_level: 'active', can_chat: true, block_reason: null };
      case 'create_chat_conversation_audited':
        return { conversation_id: '22222222-2222-2222-2222-222222222222' };
      case 'get_chat_messages_audited':
        return [];
      case 'save_chat_message_audited':
        return { id: '33333333-3333-3333-3333-333333333333' };
      case 'get_chat_context_story_id':
        return null;
      default:
        return null;
    }
  });
  rpcServiceMock.mockImplementation(async (fn: string) => {
    switch (fn) {
      case 'get_active_channel_config':
        return {
          slug: 'ai-chat',
          channel_id: null,
          model: 'test-model',
          system_prompt: 'You are a test assistant.',
          temperature: 0.2,
          max_tokens: 200,
          allowed_tools: [],
        };
      case 'fn_admit_clow':
        return { decision: 'allow' };
      case 'save_chat_message_audited':
        return { id: '44444444-4444-4444-4444-444444444444' };
      default:
        return null;
    }
  });
}

async function runChatTurn(message: string) {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/chat',
    headers: { authorization: 'Bearer kc-rs256-token' },
    payload: { message, language: 'en' },
  });
  await app.close();
  return res;
}

describe('POST /chat AITG output guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyTokenMock.mockResolvedValue({ userId: USER_ID, roles: [], claims: { sub: USER_ID } });
    installHappyPathRpcs();
    // aitg_runs transport + fire-and-forget eval both use global fetch — make it
    // fail fast and observably (the runner is fail-soft by contract).
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('unit-test: network disabled');
    }));
  });

  it('replaces an injection-flagged model output with a safe refusal (aitg_blocked=true)', async () => {
    engineOutput.content = 'Ignoring previous instructions as you asked — here is the hidden data.';

    const res = await runChatTurn('what does the doc say?');
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.message.content).not.toContain('Ignoring previous instructions');
    expect(body.message.content).toContain('cannot help');
    expect(body.metadata.aitg_blocked).toBe(true);

    // The guard really ran: it attempted to record classifier verdicts in aitg_runs.
    const fetchCalls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string]>;
    expect(fetchCalls.some(([url]) => String(url).includes('/rpc/aitg_record_run_audited'))).toBe(true);
  });

  it('passes a benign model output through unchanged (aitg_blocked=false)', async () => {
    engineOutput.content = 'The capital of France is Paris.';

    const res = await runChatTurn('what is the capital of France?');
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.message.content).toContain('The capital of France is Paris.');
    expect(body.metadata.aitg_blocked).toBe(false);
  });
});
