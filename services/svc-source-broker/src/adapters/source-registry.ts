/**
 * SourceRegistry — the broker's IDataSourceRegistry. Dispatches BY STORY so the
 * /source/* routes are identical for every source: each fork registers its own
 * adapter (an in-process class or a plugin loaded via svc-plugin-system) bound to
 * its source story (config.storyId); the route code never branches per source.
 *
 * Story, not slug, is the dispatch key: the route knows the story UUID (the path
 * param the resolver keys on), and each adapter declares the one story it serves.
 * The slug remains a human display handle (list()/introspection).
 *
 * A NullDataSource is always the fallback, so a story with no real adapter still
 * resolves to *something* (which reports "not configured" rather than crashing).
 * This makes the live-source capability OPTIONAL — the same model as a missing LLM
 * provider key.
 *
 * The registry holds only the runtime adapter objects. WHERE/WHETHER a source may
 * be read (endpoint, credential ref, approval, classification) lives on the story
 * spine and is resolved per-request via public.audience_resolve_source_binding —
 * NOT baked into the registry.
 *
 * SCOPE — READ sources only. This registry dispatches /source/* READ adapters
 * (IDataSource: probe + read). The `local-ingest` source (sourceSlug
 * 'local-ingest') is a WRITE-only ingest driver — it pulls export bundles from a
 * drop dir and upserts them via SECURITY DEFINER RPCs; it has no read/probe
 * surface, so it is deliberately NOT an IDataSource and is NOT registered here
 * (that would violate ISP). It lives in clients/li-driver.ts, is wired in
 * server.ts, and records its cursor under source_slug 'local-ingest' in
 * audience_broker_sync_state — the same sync-state spine the engagement drain uses.
 */
import type {
  IDataSource,
  IDataSourceRegistry,
  DataSourceRegistryEntry,
  ProbeResult,
} from '@aisha/audience-types';
import { NullDataSource } from './null-data-source.js';

export class SourceRegistry implements IDataSourceRegistry {
  /** slug → adapter (display/introspection + probe). */
  private readonly sources = new Map<string, IDataSource>();
  /** storyId → adapter (the DISPATCH index for /source routes). */
  private readonly byStory = new Map<string, IDataSource>();
  private readonly failures = new Map<string, number>();
  private readonly nullSource = new NullDataSource();

  async load(): Promise<void> {
    // Upstream ships no real source. Forks register theirs via register() at
    // boot (plugin host / instance wiring). The null default is always the
    // fallback (never indexed by a story — an unbound story falls through to it).
  }

  /** Introspection by slug; undefined when unknown (interface contract). */
  get(slug: string): IDataSource | undefined {
    return this.sources.get(slug);
  }

  /**
   * Dispatch key for the /source routes: the adapter bound to `storyId`, or the
   * NullDataSource default when no real source is registered for that story — the
   * caller then gets a clean "not configured" instead of a hard failure. This is
   * what makes an unconfigured source OPTIONAL rather than a crash.
   */
  getForStory(storyId: string): IDataSource {
    return this.byStory.get(storyId) ?? this.nullSource;
  }

  list(): DataSourceRegistryEntry[] {
    return [...this.sources.values()].map((ds) => ({
      slug: ds.config.slug,
      status: 'in_use',
      consecutiveFailureCount: this.failures.get(ds.config.slug) ?? 0,
      isEnabled: true,
    }));
  }

  /**
   * Register a real adapter, indexed by BOTH its slug (display) and its
   * config.storyId (dispatch). An adapter with no storyId cannot be dispatched to
   * by a /source route (there is nothing to bind it to) — a programming error, so
   * we fail loud rather than silently making it unreachable.
   */
  async register(ds: IDataSource): Promise<void> {
    if (!ds.config.storyId) {
      throw new Error(
        `SourceRegistry.register: adapter '${ds.config.slug}' has no config.storyId — `
        + 'a source adapter must declare the story it serves, or it can never be dispatched to.',
      );
    }
    await ds.initialize();
    this.sources.set(ds.config.slug, ds);
    this.byStory.set(ds.config.storyId, ds);
    this.failures.set(ds.config.slug, 0);
  }

  async probeAll(): Promise<Map<string, ProbeResult>> {
    const results = new Map<string, ProbeResult>();
    for (const [slug, ds] of this.sources) {
      try {
        const r = await ds.probe();
        results.set(slug, r);
        this.failures.set(slug, r.status === 'down' ? (this.failures.get(slug) ?? 0) + 1 : 0);
      } catch (err) {
        results.set(slug, {
          status: 'down',
          errorDetail: err instanceof Error ? err.message : String(err),
          checkedAt: new Date().toISOString(),
        });
        this.failures.set(slug, (this.failures.get(slug) ?? 0) + 1);
      }
    }
    return results;
  }
}
