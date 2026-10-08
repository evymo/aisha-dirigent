/**
 * POST /chat — kanál z faktů hledá ve znalostech pod identitou uživatele a selže nahlas (P2).
 *
 * ⛔ NAMĚŘENO 2026-10-06 (riq): extranet Ask nevyhledával ve znalostech vůbec — odpověď z faktů
 * byla jedno volání modelu bez retrievalu; deklaraci kanálu `knowledge_search` nikdo nečetl.
 *
 * Co se tu měří (šev: rpcService = služba, rpcUser = volající, mcpToolProxy = MCP):
 *   1. kanál s knowledge_search → MCP search_knowledge_v2 ZPROSTŘEDKOVANÝM tokenem uživatele
 *      (ne službou), citace v odpovědi; uložená zpráva nese jen odkazy, ne text úseků
 *   2. příběh do tokenu jen ověřený (can_access_story pod uživatelem)
 *   3. hledání nedostupné → 503 KNOWLEDGE_SEARCH_UNAVAILABLE s důvodem; model se nevolá
 *   4. token uživatele nevznikne → 503 (identita_uzivatele), MCP se nevolá vůbec
 *   5. kanál bez knowledge_search → MCP se nevolá (kontrolní vzorek: beze změny)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const PRIBEH = '44444444-4444-4444-4444-444444444444';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'route-test-hs256';
});

const mcp = vi.hoisted(() => ({
  mint: vi.fn((_u: string | null, _s: string | null): string | null => 'zprostredkovany-token'),
  invoke: vi.fn(),
}));
const llm = vi.hoisted(() => ({ chat: vi.fn() }));

// The credential boundary is independent of the user-scoped knowledge RPC fixture.
vi.mock('../../lib/credentials.js', () => ({
  credentials: {
    get: async (name: string) => process.env[name] ?? null,
    getMany: async (names: readonly string[]) => Object.fromEntries(names.map(name => [name, process.env[name] ?? null])),
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
vi.mock('../../lib/mcpToolProxy.js', () => ({
  mintMcpUserToken: mcp.mint,
  mcpToolInvoke: mcp.invoke,
  mcpToolsList: vi.fn(async () => []),
  mcpToolCall: vi.fn(),
}));
vi.mock('../../lib/defaultModel.js', () => ({
  resolveDefaultBackend: vi.fn(async () => ({ provider: 'vllm-local', model: 'lens' })),
  resolveDefaultModel: vi.fn(async () => 'lens'),
}));
vi.mock('../../lib/llmRouter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/llmRouter.js')>()),
  unifiedChat: llm.chat,
}));
vi.mock('../../reflection/decision.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../reflection/decision.js')>()),
  recordExecutionDecision: vi.fn(async () => undefined),
}));
vi.mock('@aisha/aitg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@aisha/aitg')>()),
  createAitgRunner: () => ({}),
  withAitgGuardOrRefuse: async (_o: unknown, fn: () => Promise<unknown>) => ({ result: await fn(), runIds: [], violated: false, observations: {} }),
}));
vi.mock('@aisha/llm-dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aisha/llm-dispatch')>();
  return {
    ...actual,
    getRegistry: () => ({ hasAnyAvailableBackend: async () => true, diagnostics: async () => [] }),
  };
});

import { chatRoutes } from '../../routes/chat.js';
import { verifyToken } from '../../auth.js';
import { rpcService, rpcUser } from '../../postgrest.js';

const verifyTokenMock = verifyToken as unknown as ReturnType<typeof vi.fn>;
const rpcServiceMock = rpcService as unknown as ReturnType<typeof vi.fn>;
const rpcUserMock = rpcUser as unknown as ReturnType<typeof vi.fn>;

const KANAL = (vectorStoreConfig: unknown) => ({
  channel_id: '99999999-9999-9999-9999-999999999999',
  slug: 'ai-chat',
  model: '',
  temperature: 0.2,
  max_tokens: 160,
  system_prompt: 'Jsi AISHA.',
  guardrails: { grounding: { facts_block: 'ask_answer', numbers: 'strict', skip_model_when: { pokryti: ['none'] } } },
  vector_store_config: vectorStoreConfig,
  allowed_tools: [],
});
const BLOK = {
  data: { columns: [{ key: 'odpoved' }, { key: 'pokryti' }], rows: [{ odpoved: 'V datech to není.', pokryti: 'none' }] },
  provenance: { source_slug: 'answer_verified_facts' },
};
const USEK = {
  knowledge_item_id: 'item-1', chunk_id: 'chunk-1', chunk_slug: 'smlouvy:0', similarity: 0.83, chunk_locale: 'cs',
  chunk_text: 'Rámcovou smlouvu lze vypovědět s výpovědní lhůtou 90 dní.',
};

function svet({ kanal, pribeh = null, smiNaPribeh = true }: { kanal: unknown; pribeh?: string | null; smiNaPribeh?: boolean }) {
  rpcServiceMock.mockImplementation(async (fn: string) => (fn === 'get_active_channel_config' ? kanal : null));
  rpcUserMock.mockImplementation(async (fn: string) => {
    switch (fn) {
      case 'get_chat_access_level': return { access_level: 'active', can_chat: true, block_reason: null };
      case 'create_chat_conversation_audited': return { conversation_id: '22222222-2222-2222-2222-222222222222' };
      case 'get_chat_messages_audited': return [];
      case 'get_chat_context_story_id': return pribeh;
      case 'can_access_story': return smiNaPribeh;
      case 'get_block_data': return BLOK;
      default: return null;
    }
  });
}

async function zeptejSe() {
  const app = Fastify();
  await app.register(chatRoutes);
  await app.ready();
  const res = await app.inject({
    method: 'POST', url: '/chat', headers: { authorization: 'Bearer kc' },
    payload: { message: 'Jaká je výpovědní lhůta?', language: 'cs' },
  });
  await app.close();
  return res;
}

const ulozenaOdpoved = () =>
  (rpcServiceMock.mock.calls as Array<[string, Record<string, unknown>]>)
    .find(([fn, p]) => fn === 'save_chat_message_audited' && p.p_role === 'assistant')?.[1];

describe('POST /chat — kanál z faktů se znalostmi (P2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcp.mint.mockImplementation(() => 'zprostredkovany-token');
    verifyTokenMock.mockResolvedValue({ userId: USER_ID, roles: [], claims: { sub: USER_ID } });
    llm.chat.mockResolvedValue({ text: 'Výpovědní lhůta je 90 dní [K1].', usage: { inputTokens: 900, outputTokens: 20 }, model: 'lens' });
  });

  it('hledá přes MCP tokenem UŽIVATELE, odpověď nese citace; uložená zpráva jen odkazy', async () => {
    svet({ kanal: KANAL({ knowledge_search: { enabled: true, limit: 4 } }) });
    mcp.invoke.mockResolvedValue({ ok: true, text: JSON.stringify([USEK]) });
    const res = await zeptejSe();
    expect(res.statusCode).toBe(200);
    expect(mcp.mint).toHaveBeenCalledWith(USER_ID, null);
    expect(mcp.invoke).toHaveBeenCalledWith('zprostredkovany-token', 'search_knowledge_v2', expect.objectContaining({
      query: 'Jaká je výpovědní lhůta?', limit: 4, include_ai_instructions: false, locale: 'cs',
    }));
    // Hledání ve znalostech nejde službou (žádné KB RPC pod rpcService).
    expect((rpcServiceMock.mock.calls as Array<[string]>).map(([fn]) => fn).filter((fn) => /search_knowledge/.test(fn))).toEqual([]);
    const telo = res.json();
    // Text modelu (guardraily úrovně přístupu k němu smí připojit své upozornění).
    expect(telo.message.content.startsWith('Výpovědní lhůta je 90 dní [K1].')).toBe(true);
    expect(telo.metadata.grounding).toMatchObject({ verdict: 'model' });
    expect(telo.metadata.knowledge.hits).toBe(1);
    expect(telo.metadata.knowledge.citations[0]).toMatchObject({ ref: 'K1', chunk_id: 'chunk-1', cited: true });
    expect(telo.metadata.knowledge.citations[0].excerpt).toContain('90 dní');
    const ulozena = ulozenaOdpoved()?.p_content_metadata as { knowledge?: { citations: Array<Record<string, unknown>> } };
    expect(ulozena.knowledge?.citations[0]).toMatchObject({ ref: 'K1', chunk_id: 'chunk-1' });
    expect(ulozena.knowledge?.citations[0]).not.toHaveProperty('excerpt');
  });

  it('příběh jde do tokenu jen OVĚŘENÝ (can_access_story pod uživatelem)', async () => {
    mcp.invoke.mockResolvedValue({ ok: true, text: '[]' });
    svet({ kanal: KANAL({ knowledge_search: { enabled: true } }), pribeh: PRIBEH, smiNaPribeh: true });
    await zeptejSe();
    expect(mcp.mint).toHaveBeenLastCalledWith(USER_ID, PRIBEH);
    vi.clearAllMocks();
    mcp.mint.mockImplementation(() => 'zprostredkovany-token');
    mcp.invoke.mockResolvedValue({ ok: true, text: '[]' });
    verifyTokenMock.mockResolvedValue({ userId: USER_ID, roles: [], claims: { sub: USER_ID } });
    svet({ kanal: KANAL({ knowledge_search: { enabled: true } }), pribeh: PRIBEH, smiNaPribeh: false });
    await zeptejSe();
    expect(mcp.mint).toHaveBeenLastCalledWith(USER_ID, null);
  });

  it('hledání nedostupné → 503 KNOWLEDGE_SEARCH_UNAVAILABLE s důvodem a incidentem; model se nevolá; žádný text chyby', async () => {
    svet({ kanal: KANAL({ knowledge_search: { enabled: true } }) });
    const incident = '0f0e0d0c-0b0a-4908-8706-050403020100';
    // I kdyby MCP (starší verze) text poslalo, klientovi se nepředá.
    mcp.invoke.mockResolvedValue({ ok: false, text: JSON.stringify({ error: 'embedding_unavailable', reason: 'embedding_selhal', lane: 'LANE_NEDOSTUPNA', incident, message: 'http://mesh-model.internal:8000 sha ' + 'e'.repeat(64) }) });
    const res = await zeptejSe();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'Knowledge search unavailable', code: 'KNOWLEDGE_SEARCH_UNAVAILABLE', reason: 'embedding_selhal', incident });
    expect(res.body).not.toMatch(/mesh-model|https?:\/\/|[0-9a-f]{64}/);
    expect(llm.chat).not.toHaveBeenCalled();
    expect(ulozenaOdpoved()).toBeUndefined();
  });

  it('token uživatele nevznikne → 503 identita_uzivatele, MCP se nevolá vůbec', async () => {
    svet({ kanal: KANAL({ knowledge_search: { enabled: true } }) });
    mcp.mint.mockImplementation(() => null);
    const res = await zeptejSe();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'Knowledge search unavailable', code: 'KNOWLEDGE_SEARCH_UNAVAILABLE', reason: 'identita_uzivatele' });
    expect(mcp.invoke).not.toHaveBeenCalled();
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('kanál bez knowledge_search → MCP se nevolá, odpověď jako dřív (kontrolní vzorek)', async () => {
    svet({ kanal: KANAL({ knowledge_search: { enabled: false } }) });
    const res = await zeptejSe();
    expect(res.statusCode).toBe(200);
    expect(mcp.invoke).not.toHaveBeenCalled();
    expect(res.json().metadata.knowledge).toBeUndefined();
    // pokrytí none a bez znalostí → model se nevolá (skip_model_when platí dál)
    expect(llm.chat).not.toHaveBeenCalled();
  });
});
