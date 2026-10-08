/**
 * POST /chat — story_id z požadavku jen ověřený (B8).
 *
 * ⛔ NAMĚŘENO 2026-10-01 na main 8640db9ac: /chat převzal `story_id` z těla požadavku bez
 * kontroly přístupu a poslal ho dál pod službou (route_task, reflexe, token pro MCP, kde KB
 * hledání pod službou stráž příběhu přeskakovalo) → KB cizího příběhu.
 *
 * Co se tu měří (šev PostgRESTu: rpcService = služba, rpcUser = volající):
 *   1. bez story_id handler projde dál jako dosud                    ← kontrolní vzorek
 *   2. příběh, na který uživatel smí → projde, ověřeno pod uživatelem
 *   3. cizí příběh → 403 story_forbidden DŘÍV, než se cokoli uloží nebo pošle službě
 *   4. chyba ověření → 403 (fail-closed); story_id, které není text, odmítne už validace vstupu
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const MUJ = '44444444-4444-4444-4444-444444444444';
const CIZI = '55555555-5555-5555-5555-555555555555';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'route-test-hs256';
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

import { chatRoutes } from '../../routes/chat.js';
import { verifyToken } from '../../auth.js';
import { rpcService, rpcUser } from '../../postgrest.js';

const verifyTokenMock = verifyToken as unknown as ReturnType<typeof vi.fn>;
const rpcServiceMock = rpcService as unknown as ReturnType<typeof vi.fn>;
const rpcUserMock = rpcUser as unknown as ReturnType<typeof vi.fn>;

function uzivatelSmiNa(povolene: string[], { padne = false } = {}) {
  rpcUserMock.mockImplementation(async (fn: string, params: Record<string, unknown>) => {
    switch (fn) {
      case 'can_access_story':
        if (padne) throw new Error('PostgREST 500');
        return povolene.includes(String(params.p_story_id));
      case 'get_chat_access_level':
        return { access_level: 'active', can_chat: true, block_reason: null };
      case 'create_chat_conversation_audited':
        return { conversation_id: '22222222-2222-2222-2222-222222222222' };
      case 'get_chat_messages_audited':
        return [];
      case 'save_chat_message_audited':
        return { id: '33333333-3333-3333-3333-333333333333' };
      default:
        return null;
    }
  });
}

async function posli(payload: Record<string, unknown>) {
  const app = Fastify();
  await app.register(chatRoutes);
  await app.ready();
  const res = await app.inject({
    method: 'POST',
    url: '/chat',
    headers: { authorization: 'Bearer kc-rs256-token' },
    payload,
  });
  await app.close();
  return res;
}

const volaneUzivatelem = () => (rpcUserMock.mock.calls as Array<[string, Record<string, unknown>]>).map(([fn]) => fn);

describe('POST /chat — story_id z požadavku jen ověřený (B8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyTokenMock.mockResolvedValue({ userId: USER_ID, roles: [], claims: { sub: USER_ID } });
    // Služba odpovídá null → načtení konfigurace kanálu selže (500): deterministický konec
    // AŽ ZA uložením zprávy, tj. handler prošel kontrolou příběhu.
    rpcServiceMock.mockResolvedValue(null);
  });

  it('bez story_id projde dál jako dosud (kontrolní vzorek)', async () => {
    uzivatelSmiNa([]);
    const res = await posli({ message: 'ahoj' });
    expect(res.statusCode).toBe(500);
    expect(volaneUzivatelem()).not.toContain('can_access_story');
    expect(volaneUzivatelem()).toContain('save_chat_message_audited');
  });

  it('příběh, na který uživatel smí, projde — ověřený pod uživatelem', async () => {
    uzivatelSmiNa([MUJ]);
    const res = await posli({ message: 'ahoj', story_id: MUJ });
    expect(res.statusCode).toBe(500);
    const overeni = (rpcUserMock.mock.calls as Array<[string, Record<string, unknown>]>).find(([fn]) => fn === 'can_access_story');
    expect(overeni?.[1]).toEqual({ p_story_id: MUJ });
    expect(volaneUzivatelem()).toContain('save_chat_message_audited');
  });

  it('cizí příběh → 403 story_forbidden dřív, než se cokoli uloží nebo pošle službě', async () => {
    uzivatelSmiNa([MUJ]);
    const res = await posli({ message: 'ahoj', story_id: CIZI });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'story_forbidden' });
    expect(volaneUzivatelem()).not.toContain('create_chat_conversation_audited');
    expect(volaneUzivatelem()).not.toContain('save_chat_message_audited');
    const sluzbou = (rpcServiceMock.mock.calls as Array<[string, Record<string, unknown>]>);
    expect(sluzbou.filter(([, p]) => JSON.stringify(p ?? {}).includes(CIZI))).toEqual([]);
  });

  it('chyba ověření → 403 (fail-closed)', async () => {
    uzivatelSmiNa([MUJ], { padne: true });
    const res = await posli({ message: 'ahoj', story_id: MUJ });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'story_forbidden' });
  });

  it('story_id, které není text → odmítnuto na hranici (validace vstupu 400), ne pád', async () => {
    uzivatelSmiNa([MUJ]);
    const res = await posli({ message: 'ahoj', story_id: 42 });
    expect(res.statusCode).toBe(400);
    expect(volaneUzivatelem()).not.toContain('save_chat_message_audited');
  });
});
