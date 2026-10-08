/**
 * Původ MCP pro /chat vzniká jen ze zprostředkovaného tokenu uživatele (K-35, podmínka 1).
 *
 * Co se tu měří:
 *   1. token v hlavičce MCP je uživatelský (sub = uživatel, role = authenticated), nikdy
 *      service klíč; příběh, na který uživatel smí, jde do tokenu   ← kontrolní vzorek
 *   2. bez podpisového tajemství žádný token → žádný původ (nic se nespustí)
 *   3. příběh, na který uživatel NESMÍ, do tokenu nejde (MCP hledá pod službou s p_story_id
 *      z tokenu — neověřený příběh by otevřel KB cizího příběhu)
 *   4. chyba ověření příběhu = nesmí (fail-closed)
 *
 * config.js čte prostředí při importu, proto každý případ znovu načte graf modulů.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SERVICE_TOKEN = 'sluzebni-klic';
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: { tools: [] }, id: 1 }), { status: 200 }));

function payload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

async function nacti(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return await import('../lib/chatMcpOrigin.js');
}

const smiNa = (povolene: string[]) => ({
  rpc: vi.fn(async (_fn: string, args?: Record<string, unknown>) => ({
    data: povolene.includes(String(args?.p_story_id)),
    error: null,
  })),
});

const ENV_KLICE = ['JWT_SECRET', 'POSTGREST_JWT_SECRET', 'SVC_MCP_KNOWLEDGE_URL', 'POSTGREST_SERVICE_TOKEN'];
const zaloha: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KLICE) zaloha[k] = process.env[k];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  for (const k of ENV_KLICE) {
    if (zaloha[k] === undefined) delete process.env[k];
    else process.env[k] = zaloha[k];
  }
  vi.unstubAllGlobals();
});

const ZAKLAD = {
  JWT_SECRET: 'unit-test-hs256',
  POSTGREST_JWT_SECRET: undefined,
  SVC_MCP_KNOWLEDGE_URL: 'http://mcp.test',
  POSTGREST_SERVICE_TOKEN: SERVICE_TOKEN,
};

function hlavickaMcp(): string {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return String((init?.headers as Record<string, string> | undefined)?.authorization ?? '');
}

describe('původ MCP pro /chat jen tokenem uživatele (K-35)', () => {
  it('MCP dostane token uživatele s ověřeným příběhem, nikdy service klíč (kontrolní vzorek)', async () => {
    const { createChatMcpOrigin } = await nacti(ZAKLAD);
    const puvod = await createChatMcpOrigin({ userId: 'uzivatel-1', storyId: 'pribeh-muj', pgrestUser: smiNa(['pribeh-muj']) });
    expect(puvod).not.toBeNull();
    await puvod!.list();
    const auth = hlavickaMcp();
    expect(auth.startsWith('Bearer ')).toBe(true);
    expect(auth).not.toContain(SERVICE_TOKEN);
    expect(payload(auth.slice(7))).toMatchObject({ sub: 'uzivatel-1', role: 'authenticated', story_id: 'pribeh-muj' });
  });

  it('bez podpisového tajemství není token → není původ, MCP se nevolá', async () => {
    const { createChatMcpOrigin } = await nacti({ ...ZAKLAD, JWT_SECRET: undefined });
    const puvod = await createChatMcpOrigin({ userId: 'uzivatel-1', storyId: null, pgrestUser: smiNa([]) });
    expect(puvod).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cizí příběh do tokenu nejde (jen globální KB)', async () => {
    const { createChatMcpOrigin } = await nacti(ZAKLAD);
    const puvod = await createChatMcpOrigin({ userId: 'uzivatel-1', storyId: 'pribeh-cizi', pgrestUser: smiNa(['pribeh-muj']) });
    await puvod!.list();
    expect(payload(hlavickaMcp().slice(7)).story_id).toBeNull();
  });

  it('chyba ověření příběhu = nesmí', async () => {
    const { verifiedStoryForMcp } = await nacti(ZAKLAD);
    const padajici = { rpc: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) };
    expect(await verifiedStoryForMcp(padajici, 'pribeh-muj')).toBeNull();
    const hazejici = { rpc: vi.fn(async () => { throw new Error('síť'); }) };
    expect(await verifiedStoryForMcp(hazejici, 'pribeh-muj')).toBeNull();
  });
});
