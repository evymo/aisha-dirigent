/**
 * Source registry + null adapter + freshness cache — the generic live-source
 * runtime. Verifies the OPTIONAL-source contract (no external source configured
 * behaves like a missing LLM key: cleanly unavailable, not fake data) and the
 * by-STORY dispatch that lets a fork plug its own adapter in (the story UUID the
 * /source routes carry is the dispatch key — NOT the human slug).
 */
import { describe, it, expect } from 'vitest';
import type { IDataSource } from '@aisha/audience-types';
import { MemberTier } from '@aisha/audience-types';
import { NullDataSource, SourceNotConfiguredError } from '../adapters/null-data-source.js';
import { SourceRegistry } from '../adapters/source-registry.js';
import { TtlCache } from '../lib/ttl-cache.js';

const STORY = '11111111-1111-4111-8111-111111111111';

// A test double for a fork's real adapter (e.g. tenant's plugin), bound to STORY.
// Cast via `unknown` so the mock need not re-satisfy getEntity's generic <T>.
function fakeAdapter(storyId: string, slug = 'tenant'): IDataSource {
  return {
    config: { slug, displayName: slug, version: '1', capabilities: ['realtime-fdw'], authKind: 'pg_dsn', storyId },
    async initialize() {},
    async *fetchAggregateSnapshots() {},
    async getEntity() { return { entity: { ok: true }, callerScope: { userId: 'op', tier: 'admin', allowedReason: 't' } }; },
    async probe() { return { status: 'healthy', checkedAt: new Date(0).toISOString() }; },
    async shutdown() {},
  } as unknown as IDataSource;
}

describe('NullDataSource — source is OPTIONAL', () => {
  it('getEntity fails with source_not_configured (unavailable, not fake data)', async () => {
    const ds = new NullDataSource();
    await expect(ds.getEntity('actor', 'x', { userId: 'op', tier: MemberTier.Admin })).rejects.toBeInstanceOf(SourceNotConfiguredError);
  });

  it('probe is healthy-but-empty, not down', async () => {
    const r = await new NullDataSource().probe();
    expect(r.status).toBe('healthy');
  });

  it('batch snapshots over the null source is a clean no-op', async () => {
    const out = [];
    for await (const s of new NullDataSource().fetchAggregateSnapshots()) out.push(s);
    expect(out).toHaveLength(0);
  });

  it('declares no capabilities → never selected for a live read', () => {
    expect(new NullDataSource().config.capabilities).toEqual([]);
  });
});

describe('SourceRegistry — dispatch by STORY, null default', () => {
  it('an unknown story resolves to the NullDataSource (optional, not a crash)', async () => {
    const reg = new SourceRegistry();
    await reg.load();
    const ds = reg.getForStory('00000000-0000-4000-8000-000000000000');
    await expect(ds.getEntity('actor', 'x', { userId: 'op', tier: MemberTier.Admin })).rejects.toBeInstanceOf(SourceNotConfiguredError);
  });

  it('a registered adapter is dispatched by its STORY id (fork plugin path)', async () => {
    const reg = new SourceRegistry();
    await reg.load();
    const fake = fakeAdapter(STORY);
    await reg.register(fake);
    // getForStory(storyUUID) — the key the /source routes actually pass.
    expect(reg.getForStory(STORY)).toBe(fake);
    // get(slug) is display/introspection only.
    expect(reg.get('tenant')).toBe(fake);
    expect(reg.list().some((e) => e.slug === 'tenant' && e.isEnabled)).toBe(true);
  });

  it('refuses to register an adapter with no config.storyId (else it is undispatchable)', async () => {
    const reg = new SourceRegistry();
    const bad = { ...fakeAdapter(STORY) };
    (bad.config as { storyId?: string }).storyId = undefined;
    await expect(reg.register(bad as unknown as IDataSource)).rejects.toThrow(/storyId/);
  });
});

describe('TtlCache — freshness window', () => {
  it('serves within TTL, misses after expiry, invalidates by prefix', () => {
    let t = 1000;
    const c = new TtlCache<number>(100, () => t);
    c.set('s1:kpi', 42);
    expect(c.get('s1:kpi')).toBe(42);
    t = 1101; // past TTL
    expect(c.get('s1:kpi')).toBeUndefined();
    c.set('s1:a', 1); c.set('s1:b', 2); c.set('s2:a', 3);
    expect(c.invalidate('s1:')).toBe(2);
    expect(c.get('s2:a')).toBe(3);
  });
});
