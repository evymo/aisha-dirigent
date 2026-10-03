/**
 * /create-token — o vstupu rozhoduje DB, trasa jen poslouchá.
 *
 * ⛔ NAMĚŘENO (audit hlasu 2026-09-29, H-5 + krok 5b): trasa volala dvě RPC, která
 * neexistovala (každá místnost = 404), a u konzultace bez story nekontrolovala
 * vůbec nic — token do cizího hovoru dostal kdokoli přihlášený se jménem místnosti.
 * Teď jedno služební RPC get_voice_room_entry vrací místnost i verdikt
 * (can_enter_voice_room). Tenhle test drží, že trasa verdikt NEOBEJDE: bez
 * may_enter=true žádný token ani zápis účasti, a identita jde z ověřeného JWT,
 * ne z těla požadavku.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const rpcService = vi.fn();
const createRoomAccessToken = vi.fn(async () => 'lk-token');

vi.mock('../auth.js', () => ({
  verifyToken: vi.fn(async () => ({ userId: 'u-overeny' })),
}));
vi.mock('../postgrest.js', () => ({ rpcService: (...a: unknown[]) => rpcService(...a) }));
vi.mock('../livekit-jwt.js', () => ({
  createRoomAccessToken: (...a: unknown[]) => createRoomAccessToken(...(a as [])),
}));

const { tokenRoutes } = await import('../routes/token.js');

async function zadost(body: unknown) {
  const app = Fastify();
  await app.register(tokenRoutes);
  const res = await app.inject({ method: 'POST', url: '/create-token', headers: { authorization: 'Bearer x' }, payload: body as object });
  await app.close();
  return res;
}

const mistnost = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'vr-1', is_active: true, story_id: null, room_type: 'consultation', may_enter: true, ...o,
});

/** Odpovědi RPC podle jména; get_voice_room_entry se nastavuje v testu. */
function rpc(entry: unknown | Error) {
  rpcService.mockImplementation(async (jmeno: string) => {
    if (jmeno === 'get_voice_room_entry') {
      if (entry instanceof Error) throw entry;
      return entry;
    }
    if (jmeno === 'get_profile_display_name') return { display_name: 'Ověřený' };
    return null;
  });
}
const volano = (jmeno: string) => rpcService.mock.calls.filter((c) => c[0] === jmeno);

beforeEach(() => {
  rpcService.mockReset();
  createRoomAccessToken.mockClear();
});

describe('svc-livekit /create-token — verdikt vstupu z DB', () => {
  it('may_enter=false → 403, žádný token, žádný zápis účasti', async () => {
    rpc([mistnost({ may_enter: false })]);
    const res = await zadost({ roomName: 'consultation-deadbeef' });
    expect(res.statusCode).toBe(403);
    expect(createRoomAccessToken).not.toHaveBeenCalled();
    expect(volano('upsert_call_participant')).toHaveLength(0);
  });

  it('chybějící may_enter (starší tvar odpovědi) se bere jako zákaz, ne jako souhlas', async () => {
    rpc([{ id: 'vr-1', is_active: true, story_id: null, room_type: 'consultation' }]);
    expect((await zadost({ roomName: 'consultation-deadbeef' })).statusCode).toBe(403);
    expect(createRoomAccessToken).not.toHaveBeenCalled();
  });

  it('neaktivní místnost → 403 i s may_enter=true', async () => {
    rpc([mistnost({ is_active: false })]);
    expect((await zadost({ roomName: 'r' })).statusCode).toBe(403);
    expect(createRoomAccessToken).not.toHaveBeenCalled();
  });

  it('neexistující místnost → 404', async () => {
    rpc([]);
    expect((await zadost({ roomName: 'neni' })).statusCode).toBe(404);
  });

  it('selhání dotazu → 503 (ne 404 a hlavně ne token)', async () => {
    rpc(new Error('PGRST connection refused'));
    const res = await zadost({ roomName: 'r' });
    expect(res.statusCode).toBe(503);
    expect(createRoomAccessToken).not.toHaveBeenCalled();
  });

  it('may_enter=true → token; verdikt se ptá na OVĚŘENOU identitu, ne na tělo požadavku', async () => {
    rpc([mistnost()]);
    const res = await zadost({ roomName: 'consultation-deadbeef', userId: 'u-podvrzeny', p_user_id: 'u-podvrzeny' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ token: 'lk-token', identity: 'u-overeny' });
    expect(volano('get_voice_room_entry')).toEqual([
      ['get_voice_room_entry', { p_livekit_room_name: 'consultation-deadbeef', p_user_id: 'u-overeny' }],
    ]);
    expect(volano('upsert_call_participant')[0]?.[1]).toMatchObject({ p_user_id: 'u-overeny', p_voice_room_id: 'vr-1' });
  });

  it('trasa už nevolá RPC, která v DB neexistují', async () => {
    rpc([mistnost({ story_id: 's-1', room_type: 'ptt' })]);
    await zadost({ roomName: 'r' });
    const jmena = rpcService.mock.calls.map((c) => c[0]);
    expect(jmena).not.toContain('get_voice_room_by_livekit_name');
    expect(jmena).not.toContain('check_story_membership');
  });
});
