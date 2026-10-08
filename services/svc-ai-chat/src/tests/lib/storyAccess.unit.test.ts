/**
 * lib/storyAccess — jediný predikát pro story_id z požadavku (B8). Smí jen jasné „ano“.
 *
 * Co se tu měří:
 *   1. can_access_story = true → smí                                   ← kontrolní vzorek
 *   2. false, chyba RPC, výjimka klienta i ne-boolean odpověď → nesmí (fail-closed)
 *   3. bez uživatele nebo bez podpisového tajemství → nesmí, bez dotazu do DB
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PostgrestClient } from '../../lib/deps.js';

const rpcUserMock = vi.hoisted(() => vi.fn());
vi.mock('../../postgrest.js', () => ({ rpcService: vi.fn(), rpcUser: rpcUserMock }));

const klient = (rpc: () => Promise<unknown>) => ({ rpc: vi.fn(rpc) }) as unknown as PostgrestClient;

async function nacti(secret: string | undefined) {
  vi.resetModules();
  if (secret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = secret;
  delete process.env.POSTGREST_JWT_SECRET;
  return await import('../../lib/storyAccess.js');
}

const zaloha = { JWT_SECRET: process.env.JWT_SECRET, POSTGREST_JWT_SECRET: process.env.POSTGREST_JWT_SECRET };
beforeEach(() => rpcUserMock.mockReset());
afterEach(() => {
  for (const [k, v] of Object.entries(zaloha)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('canAccessStory — smí jen jasné ano (B8)', () => {
  it('can_access_story = true → smí (kontrolní vzorek)', async () => {
    const { canAccessStory } = await nacti('unit-hs256');
    expect(await canAccessStory(klient(async () => ({ data: true, error: null })), 'p')).toBe(true);
  });

  it('false, chyba RPC, výjimka klienta i ne-boolean odpověď → nesmí', async () => {
    const { canAccessStory } = await nacti('unit-hs256');
    expect(await canAccessStory(klient(async () => ({ data: false, error: null })), 'p')).toBe(false);
    expect(await canAccessStory(klient(async () => ({ data: true, error: { message: 'x' } })), 'p')).toBe(false);
    expect(await canAccessStory(klient(async () => { throw new Error('síť'); }), 'p')).toBe(false);
    expect(await canAccessStory(klient(async () => ({ data: 'true', error: null })), 'p')).toBe(false);
  });
});

describe('userCanAccessStory — volající podle id (B8)', () => {
  it('bez uživatele → nesmí, DB se neptá', async () => {
    const { userCanAccessStory } = await nacti('unit-hs256');
    expect(await userCanAccessStory(null, 'p')).toBe(false);
    expect(rpcUserMock).not.toHaveBeenCalled();
  });

  it('bez podpisového tajemství → nesmí, DB se neptá', async () => {
    const { userCanAccessStory } = await nacti(undefined);
    expect(await userCanAccessStory('u-1', 'p')).toBe(false);
    expect(rpcUserMock).not.toHaveBeenCalled();
  });

  it('s uživatelem se ptá pod jeho identitou', async () => {
    const { userCanAccessStory } = await nacti('unit-hs256');
    rpcUserMock.mockResolvedValue(true);
    expect(await userCanAccessStory('u-1', 'p')).toBe(true);
    expect(rpcUserMock).toHaveBeenCalledWith('can_access_story', { p_story_id: 'p' }, expect.any(String));
  });
});
