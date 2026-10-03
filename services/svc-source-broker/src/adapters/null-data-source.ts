/**
 * NullDataSource — the default, always-present adapter for "no external source
 * configured". Ships upstream so the whole stack RUNS without any real source
 * (the aisha-guru default story reads its own mirror/local data). This is the
 * same optionality model as the platform's LLM capability: when no key/source
 * is configured the feature is cleanly UNAVAILABLE — not fake data, not a crash.
 *
 * Distinct from a configured-but-broken source, which fails LOUD (no-fallbacks).
 * The Null adapter is the "unconfigured" branch made explicit, so the registry
 * always resolves to *something* rather than special-casing absence everywhere.
 */
import type {
  IDataSource,
  DataSourceConfig,
  EntityType,
  ActorAggregateSnapshot,
  ScopedEntityResult,
  ProbeResult,
  MemberTier,
  SourceConnection,
} from '@aisha/audience-types';

/** Thrown when a route tries to LIVE-read but no real source is configured. */
export class SourceNotConfiguredError extends Error {
  readonly code = 'source_not_configured';
  constructor(slug: string) {
    super(`No external data source configured for '${slug}' — live source-read is unavailable`);
    this.name = 'SourceNotConfiguredError';
  }
}

export class NullDataSource implements IDataSource {
  readonly config: DataSourceConfig;

  constructor(slug = 'default') {
    this.config = {
      slug,
      displayName: 'No external source (default)',
      version: '1.0.0',
      capabilities: [], // declares nothing → never selected for live reads
      authKind: 'none',
    };
  }

  async initialize(): Promise<void> {
    /* nothing to initialise */
  }

  // eslint-disable-next-line require-yield
  async *fetchAggregateSnapshots(): AsyncIterable<ActorAggregateSnapshot> {
    // No source → no snapshots. Batch sync over the null source is a clean no-op.
    return;
  }

  async getEntity<T = unknown>(
    _entityType: EntityType,
    _externalId: string,
    _callerContext: { userId: string; tier: MemberTier },
    _sourceConnection?: SourceConnection,
  ): Promise<ScopedEntityResult<T>> {
    // No source configured — the connection (if any) is irrelevant; fail cleanly.
    throw new SourceNotConfiguredError(this.config.slug);
  }

  async probe(): Promise<ProbeResult> {
    // Not "down" — there is simply nothing to probe. Report healthy-but-empty.
    return { status: 'healthy', checkedAt: new Date().toISOString() };
  }

  async shutdown(): Promise<void> {
    /* nothing to close */
  }
}
