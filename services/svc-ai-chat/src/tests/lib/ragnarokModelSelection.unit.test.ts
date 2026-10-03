/**
 * Unit: resolveRagnarokRetrievalSettings — AISHA governs ragnarok's embedding model.
 *
 * Asserts the helper (a) resolves via the ONE resolver with the embedding capability
 * and the live serviceable pool, (b) shapes the pick as a ragnarok `settings` override,
 * and (c) FAILS LOUD (null → caller skips ragnarok) rather than ever returning a
 * hardcoded default — the owner's "zadne defaulty ani u ragnaroku" rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcServiceMock = vi.hoisted(() => vi.fn());
vi.mock('../../postgrest.js', () => ({ rpcService: rpcServiceMock }));
vi.mock('../../lib/llmRouter.js', () => ({ selectServiceableSlugs: () => ['openai'] }));

import { resolveRagnarokRetrievalSettings } from '../../lib/ragnarokModelSelection.js';

describe('resolveRagnarokRetrievalSettings — AISHA governs ragnarok embedding model', () => {
  beforeEach(() => rpcServiceMock.mockReset());

  it('injects the AISHA-resolved embedding model as ragnarok retrieval settings', async () => {
    rpcServiceMock.mockResolvedValueOnce({ resolved: true, top: { model_id: 'text-embedding-3-large' } });

    const s = await resolveRagnarokRetrievalSettings({ query: 'why is the sky blue', storyId: 'st-1' });

    expect(s).toEqual({
      retrieval: { model: { provider: 'OpenAI', name: 'text-embedding-3-large' } },
      generation: { enabled: false },
    });
    // resolved by the ONE resolver, with the embedding capability + live serviceable pool
    expect(rpcServiceMock).toHaveBeenCalledWith(
      'aisha_resolve_clow_backend',
      expect.objectContaining({
        p_clow: expect.objectContaining({ task_kind: 'embedding' }),
        p_context: expect.objectContaining({ serviceable_slugs: ['openai'] }),
      }),
      undefined,
    );
  });

  it('whatever model AISHA picks is honored (no second guessing)', async () => {
    rpcServiceMock.mockResolvedValueOnce({ resolved: true, top: { model_id: 'bge-m3-local' } });
    const s = await resolveRagnarokRetrievalSettings({ query: 'q' });
    expect(s?.retrieval.model.name).toBe('bge-m3-local');
  });

  it('fails loud (null → caller skips ragnarok) when AISHA resolves nothing — no default', async () => {
    rpcServiceMock.mockResolvedValueOnce({ resolved: false, top: null });
    expect(await resolveRagnarokRetrievalSettings({ query: 'q' })).toBeNull();
  });

  it('fails loud (null) when the resolver errors — never a hardcoded model', async () => {
    rpcServiceMock.mockRejectedValueOnce(new Error('postgrest down'));
    expect(await resolveRagnarokRetrievalSettings({ query: 'q' })).toBeNull();
  });

  it('returns null when the resolver yields no model_id (resolved but empty top)', async () => {
    rpcServiceMock.mockResolvedValueOnce({ resolved: true, top: {} });
    expect(await resolveRagnarokRetrievalSettings({ query: 'q' })).toBeNull();
  });
});
