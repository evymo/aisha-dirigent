/**
 * POST /chat — kanál z faktů (`guardrails.grounding`), fáze 4 „AI na CPU".
 *
 * Celý tah /chat s kanálem, který deklaruje fakta z RPC. Měří se:
 *   - fakta jdou z deklarovaného BLOKU Asku POD UŽIVATELEM (rpcUser, get_block_data);
 *   - workflow (klasifikace + specialista = 2 volání modelu) se VŮBEC nespustí;
 *   - text modelu s číslem mimo fakta se k uživateli nedostane → fakta (KONTROLNÍ VZOREK);
 *   - text jen s čísly z faktů projde jako odpověď;
 *   - pokrytí `none` model nevolá;
 *   - chyba faktů = 502 GROUNDED_UNAVAILABLE (klient ukáže svá fakta), ne vymyšlená odpověď;
 *   - model v kanálu z faktů = chyba deklarace (model vybírá resolver kvůli rezidenci).
 *
 * Tierové výstupní guardraily (upozornění pod odpovědí) platí i tady — parita s
 * běžnou cestou; proto se měří ZAČÁTEK odpovědi.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const USER_ID = '11111111-1111-1111-1111-111111111111';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'route-test-hs256';
  process.env.GIT_SHA = 'deadbeefcafe';
});

// Čtečka pověření (2026-10-02): v testu trezor = prostředí procesu (tvar createCredentialReader).
vi.mock('../../lib/credentials.js', () => ({
  credentials: {
    get: async (n: string) => process.env[n] ?? null,
    getMany: async (ns: readonly string[]) => Object.fromEntries(ns.map((n) => [n, process.env[n] ?? null])),
    migrateEnvCredentials: async () => ({ moved: [], kept: [], absent: [], failed: [] }),
    invalidate: () => undefined,
  },
  POVERENI_Z_PROSTREDI: [],
}));
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

vi.mock('../../lib/workflowEngine.js', () => ({
  DEFAULT_CHAT_WORKFLOW: { nodes: {} },
  loadWorkflow: vi.fn(async () => ({ graph: { nodes: {} }, workflowId: null, name: 'test-wf' })),
  createWorkflowEngine: vi.fn(() => {
    throw new Error('kanál z faktů nesmí spustit workflow');
  }),
}));

vi.mock('../../lib/orchestrationBridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orchestrationBridge.js')>();
  return {
    ...actual,
    routeViaAisha: vi.fn(async () => null),
    enrichWithAishaContext: vi.fn(async () => null),
    chooseExecutionStrategy: vi.fn(async () => null),
    kickOffReflectionWorkflow: vi.fn(async () => null),
  };
});

const model = { text: '' };
vi.mock('../../lib/llmRouter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/llmRouter.js')>();
  return {
    ...actual,
    unifiedChat: vi.fn(async () => ({
      text: model.text, usage: { inputTokens: 400, outputTokens: 30 }, provider: 'vllm', model: 'default-lens',
    })),
  };
});
vi.mock('../../lib/defaultModel.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/defaultModel.js')>();
  return { ...actual, resolveDefaultBackend: vi.fn(async () => ({ model: 'default-lens', provider: 'vllm' })) };
});
vi.mock('../../reflection/decision.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../reflection/decision.js')>();
  return { ...actual, recordExecutionDecision: vi.fn(async () => 'decision-id') };
});

import { chatRoutes } from '../../routes/chat.js';
import { verifyToken } from '../../auth.js';
import { rpcService, rpcUser } from '../../postgrest.js';
import { unifiedChat } from '../../lib/llmRouter.js';
import { createWorkflowEngine } from '../../lib/workflowEngine.js';

const verifyTokenMock = verifyToken as unknown as ReturnType<typeof vi.fn>;
const rpcServiceMock = rpcService as unknown as ReturnType<typeof vi.fn>;
const rpcUserMock = rpcUser as unknown as ReturnType<typeof vi.fn>;
const unifiedChatMock = unifiedChat as unknown as ReturnType<typeof vi.fn>;

const ODPOVED = 'Inspirace: dluh (po splatnosti) 194 360 Kč, nejstarší 686 dní; k úhradě celkem 259 597 Kč.';
const blok = (odpoved: string, pokryti = 'partial') => ({
  data: {
    columns: [{ key: 'odpoved', label_key: 'app.cols.answer' }, { key: 'pokryti' }, { key: 'zdroj' }],
    rows: [{ odpoved, pokryti, zdroj: 'get_counterparty_metric' }],
  },
  provenance: { source_slug: 'answer_verified_facts', trace_id: 'answer_chain:answer' },
});
const FAKTA = blok(ODPOVED);
const KANAL = {
  slug: 'ai-chat',
  channel_id: null,
  model: '',
  system_prompt: 'Odpovídej jen z dodaných faktů.',
  temperature: 0.2,
  max_tokens: 160,
  allowed_tools: [],
  guardrails: { grounding: { facts_block: 'ask_answer', numbers: 'strict', max_concurrent: 1, skip_model_when: { pokryti: ['none'] } } },
};

let fakta: unknown = FAKTA;
let kanal: Record<string, unknown> = KANAL;
const volaniFaktu: Array<Record<string, unknown>> = [];

function installRpcs() {
  rpcUserMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    switch (fn) {
      case 'get_chat_access_level':
        return { access_level: 'active', can_chat: true, block_reason: null };
      case 'create_chat_conversation_audited':
        return { conversation_id: '22222222-2222-2222-2222-222222222222' };
      case 'get_chat_messages_audited':
        return [];
      case 'save_chat_message_audited':
        return { id: '33333333-3333-3333-3333-333333333333' };
      case 'get_block_data':
        volaniFaktu.push(args);
        if (fakta instanceof Error) throw fakta;
        return fakta;
      default:
        return null;
    }
  });
  rpcServiceMock.mockImplementation(async (fn: string) => {
    switch (fn) {
      case 'get_active_channel_config':
        return kanal;
      case 'save_chat_message_audited':
        return { id: '44444444-4444-4444-4444-444444444444' };
      default:
        return null;
    }
  });
}

async function tah(message: string, scope?: Record<string, unknown>) {
  const app = Fastify();
  await app.register(chatRoutes);
  await app.ready();
  const res = await app.inject({
    method: 'POST',
    url: '/chat',
    headers: { authorization: 'Bearer kc-rs256-token' },
    payload: { message, language: 'cs', ...(scope ? { scope } : {}) },
  });
  await app.close();
  return res;
}

describe('POST /chat — kanál z faktů', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    volaniFaktu.length = 0;
    fakta = FAKTA;
    kanal = KANAL;
    verifyTokenMock.mockResolvedValue({ userId: USER_ID, roles: [], claims: { sub: USER_ID } });
    installRpcs();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('unit-test: network disabled');
    }));
  });

  it('text modelu jen s čísly z faktů projde; fakta pod uživatelem se scope; workflow se nespustí', async () => {
    model.text = 'Inspirace dluží 194 360 Kč po splatnosti, nejstarší faktura 686 dní.';
    const res = await tah('Kolik dluží Inspirace?', { firma: '09519696' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message.content.startsWith(model.text)).toBe(true);
    expect(body.message.routing_category).toBe('grounded');
    expect(body.metadata.grounding).toMatchObject({ verdict: 'model', reason: 'model', block: 'ask_answer', source: 'answer_verified_facts' });
    expect(volaniFaktu).toEqual([{ p_block_slug: 'ask_answer', p_params: { question: 'Kolik dluží Inspirace?', scope: { firma: '09519696' } } }]);
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    expect(unifiedChatMock.mock.calls[0][0]).toMatchObject({ model: 'default-lens', provider: 'vllm', maxTokens: 160 });
    expect(unifiedChatMock.mock.calls[0][0].tools).toBeUndefined();
    expect(createWorkflowEngine).not.toHaveBeenCalled();
  });

  it('KONTROLNÍ VZOREK: vymyšlená částka se k uživateli nedostane — vrátí se fakta', async () => {
    model.text = 'Inspirace dluží 195 000 Kč.';
    const res = await tah('Kolik dluží Inspirace?');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message.content.startsWith(ODPOVED)).toBe(true);
    expect(body.message.content).not.toContain('195 000');
    expect(body.metadata.grounding).toMatchObject({ verdict: 'fakta', reason: 'cizi_cisla', cizi: ['195 000'] });
  });

  it('pokrytí none (skip_model_when) → model se nevolá, odpověď = fakta', async () => {
    fakta = blok('To v datech nemám.', 'none');
    const res = await tah('Kolik je hodin?');
    expect(res.json().message.content.startsWith('To v datech nemám.')).toBe(true);
    expect(unifiedChatMock).not.toHaveBeenCalled();
  });

  it('chyba faktů → 502 GROUNDED_UNAVAILABLE, žádná odpověď modelu', async () => {
    fakta = new Error('permission denied for function get_block_data');
    const res = await tah('Kolik dluží Inspirace?');
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('GROUNDED_UNAVAILABLE');
    expect(unifiedChatMock).not.toHaveBeenCalled();
  });

  it('kanál z faktů s pevným modelem = chyba deklarace (model vybírá resolver)', async () => {
    kanal = { ...KANAL, model: 'gpt-4o-mini' };
    const res = await tah('Kolik dluží Inspirace?');
    expect(res.statusCode).toBe(500);
    expect(unifiedChatMock).not.toHaveBeenCalled();
  });

  it('scope, který není objekt, je chyba požadavku', async () => {
    const app = Fastify();
    await app.register(chatRoutes);
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/chat', headers: { authorization: 'Bearer kc-rs256-token' },
      payload: { message: 'x', scope: ['firma'] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
