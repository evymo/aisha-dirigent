/**
 * Omni /v1 — story z těla požadavku jen ověřený (B8).
 *
 * ⛔ NAMĚŘENO 2026-10-01 na main 8640db9ac: PAT bez vazby na příběh převzal `story_id` z těla
 * bez kontroly; šel do tokenu pro MCP (KB hledání pod službou stráž příběhu přeskakovalo),
 * ensureTurnRun, admitClow i reflexe → KB cizího příběhu.
 *
 * Co se tu měří (šev PostgRESTu: rpcService = validate_mcp_token, rpcUser = volající):
 *   1. PAT s vazbou + shodný příběh → projde bez dalšího dotazu          ← kontrolní vzorek
 *   2. PAT bez vazby + příběh, na který vlastník smí → projde, ověřeno pod vlastníkem
 *   3. PAT bez vazby + cizí příběh → 403 story_forbidden
 *   4. PAT bez uživatele (legacy) + příběh → 403 (nejde ověřit)
 *   5. chyba ověření → 403 (fail-closed)
 *   6. dosavadní pravidla beze změny: bez příběhu 403 unscoped_token, nesoulad 403 story_mismatch
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const VLASTNIK = '11111111-1111-1111-1111-111111111111';
const MUJ = '44444444-4444-4444-4444-444444444444';
const CIZI = '55555555-5555-5555-5555-555555555555';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'route-test-hs256';
});

vi.mock('../../postgrest.js', () => ({ rpcService: vi.fn(), rpcUser: vi.fn() }));

import { authenticateOmni } from '../../routes/omniAuth.js';
import { rpcService, rpcUser } from '../../postgrest.js';

const rpcServiceMock = rpcService as unknown as ReturnType<typeof vi.fn>;
const rpcUserMock = rpcUser as unknown as ReturnType<typeof vi.fn>;

function pat(opts: { userId?: string | null; scoped?: string | null }) {
  rpcServiceMock.mockImplementation(async (fn: string) =>
    fn === 'validate_mcp_token'
      ? { valid: true, user_id: opts.userId === undefined ? VLASTNIK : opts.userId, scoped_to_story_id: opts.scoped ?? null, rate_limit_rpm: 60 }
      : null);
}

function smiNa(povolene: string[], { padne = false } = {}) {
  rpcUserMock.mockImplementation(async (fn: string, params: Record<string, unknown>) => {
    if (fn !== 'can_access_story') return null;
    if (padne) throw new Error('PostgREST 500');
    return povolene.includes(String(params.p_story_id));
  });
}

const PAT = 'Bearer mcp_testovaci_token';

describe('authenticateOmni — story z těla jen ověřený (B8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    smiNa([MUJ]);
  });

  it('PAT s vazbou + shodný příběh projde bez dalšího dotazu (kontrolní vzorek)', async () => {
    pat({ scoped: MUJ });
    const r = await authenticateOmni(PAT, { story_id: MUJ });
    expect(r).toMatchObject({ ok: true, storyId: MUJ });
    expect(rpcUserMock).not.toHaveBeenCalled();
  });

  it('PAT bez vazby + příběh, na který vlastník smí → projde, ověřeno pod vlastníkem', async () => {
    pat({ scoped: null });
    const r = await authenticateOmni(PAT, { story_id: MUJ });
    expect(r).toMatchObject({ ok: true, storyId: MUJ });
    expect(rpcUserMock).toHaveBeenCalledWith('can_access_story', { p_story_id: MUJ }, expect.any(String));
    const token = String(rpcUserMock.mock.calls[0][2]);
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())).toMatchObject({ sub: VLASTNIK, role: 'authenticated' });
  });

  it('PAT bez vazby + cizí příběh → 403 story_forbidden', async () => {
    pat({ scoped: null });
    const r = await authenticateOmni(PAT, { metadata: { story_id: CIZI } });
    expect(r).toEqual({ ok: false, http: 403, body: { error: 'story_forbidden' } });
  });

  it('PAT bez uživatele (legacy) + příběh → 403, nejde ověřit', async () => {
    pat({ userId: null, scoped: null });
    const r = await authenticateOmni(PAT, { story_id: MUJ });
    expect(r).toEqual({ ok: false, http: 403, body: { error: 'story_forbidden' } });
    expect(rpcUserMock).not.toHaveBeenCalled();
  });

  it('chyba ověření → 403 (fail-closed)', async () => {
    pat({ scoped: null });
    smiNa([MUJ], { padne: true });
    const r = await authenticateOmni(PAT, { story_id: MUJ });
    expect(r).toEqual({ ok: false, http: 403, body: { error: 'story_forbidden' } });
  });

  it('dosavadní pravidla beze změny: bez příběhu unscoped_token, nesoulad story_mismatch', async () => {
    pat({ scoped: null });
    expect(await authenticateOmni(PAT, {})).toEqual({ ok: false, http: 403, body: { error: 'unscoped_token' } });
    pat({ scoped: MUJ });
    expect(await authenticateOmni(PAT, { story_id: CIZI })).toEqual({ ok: false, http: 403, body: { error: 'story_mismatch' } });
  });
});
