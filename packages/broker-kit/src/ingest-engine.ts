/**
 * ingest-engine.ts — the driver-POLYMORPHIC batch ingest (generalized from
 * svc-source-broker's scheduler.ts, which was hardcoded to one source + a concrete
 * pg client). The engine owns cursor + circuit-breaker + one ingest_run ledger;
 * the per-source driver only implements readBatch + describeContract, and a
 * SourceMapper turns each native record into a named gated UpsertCommand.
 *
 * Fuses the two seams: the tick dispatches THROUGH the registry (one driver per
 * story) instead of a hardcoded SourcePgClient. All I/O injected → unit-testable.
 */
import type {
  ReadDriver, SourceMapper, BatchReadRequest, SourceConnection,
} from '@aisha/audience-types';

export interface IngestDeps {
  resolveBinding(storyId: string, endpointRole: string): Promise<SourceConnection | null>;
  /** Execute a named gated write (PostgREST /rpc/<rpc>) — the ONLY DB write path. */
  rpc(rpcName: string, payload: Record<string, unknown>): Promise<void>;
  /** Record one ingest run (rows, cursor, ok/err) into the single ledger. */
  recordRun?(run: {
    storyId: string; slug: string; rows: number; cursor: string | null; ok: boolean; error?: string;
  }): Promise<void>;
  assertContract?(driver: ReadDriver, conn: SourceConnection): Promise<void>;
  endpointRole?: string; // default 'source-api'
  circuitTripThreshold?: number; // consecutive failures to open the circuit (default 5)
}

interface StoryState {
  cursor: string | null;
  consecutiveFailures: number;
  circuitOpen: boolean;
}

export interface IngestResult {
  storyId: string;
  slug: string;
  status: 'ok' | 'skipped_circuit_open' | 'not_configured' | 'error';
  rows: number;
  cursor: string | null;
  error?: string;
}

export class IngestEngine {
  private readonly state = new Map<string, StoryState>();
  private readonly threshold: number;

  constructor(private readonly deps: IngestDeps) {
    this.threshold = deps.circuitTripThreshold ?? 5;
  }

  private stateFor(storyId: string): StoryState {
    let s = this.state.get(storyId);
    if (!s) { s = { cursor: null, consecutiveFailures: 0, circuitOpen: false }; this.state.set(storyId, s); }
    return s;
  }

  /** One tick for one story's driver. Reads from the cursor, maps, upserts, advances. */
  async runOnce<TRec>(
    storyId: string,
    driver: ReadDriver<TRec>,
    mapper: SourceMapper<TRec>,
    opts: { entityType: string; limit?: number } = { entityType: 'default' },
  ): Promise<IngestResult> {
    const slug = driver.config.slug;
    const st = this.stateFor(storyId);
    if (st.circuitOpen) {
      return { storyId, slug, status: 'skipped_circuit_open', rows: 0, cursor: st.cursor };
    }

    const endpointRole = this.deps.endpointRole ?? 'source-api';
    const conn = await this.deps.resolveBinding(storyId, endpointRole);
    if (!conn) {
      return { storyId, slug, status: 'not_configured', rows: 0, cursor: st.cursor };
    }

    try {
      if (this.deps.assertContract) await this.deps.assertContract(driver as ReadDriver, conn);
      const req: BatchReadRequest = { entityType: opts.entityType, since: st.cursor ?? undefined, limit: opts.limit };
      let rows = 0;
      let lastCursor = st.cursor;
      for await (const rec of driver.readBatch(req, conn)) {
        const cmd = mapper(rec);
        await this.deps.rpc(cmd.rpc, cmd.payload);
        rows++;
        // a driver MAY expose a per-record cursor; default: opaque advance by count.
        const c = (rec as { cursor?: string }).cursor;
        if (typeof c === 'string') lastCursor = c;
      }
      st.cursor = lastCursor;
      st.consecutiveFailures = 0;
      await this.deps.recordRun?.({ storyId, slug, rows, cursor: st.cursor, ok: true });
      return { storyId, slug, status: 'ok', rows, cursor: st.cursor };
    } catch (err) {
      st.consecutiveFailures++;
      if (st.consecutiveFailures >= this.threshold) st.circuitOpen = true;
      const error = err instanceof Error ? err.message : String(err);
      await this.deps.recordRun?.({ storyId, slug, rows: 0, cursor: st.cursor, ok: false, error });
      return { storyId, slug, status: 'error', rows: 0, cursor: st.cursor, error };
    }
  }

  /** Manual circuit reset (ops). */
  resetCircuit(storyId: string): void {
    const s = this.state.get(storyId);
    if (s) { s.circuitOpen = false; s.consecutiveFailures = 0; }
  }

  snapshot(storyId: string): Readonly<StoryState> | undefined {
    return this.state.get(storyId);
  }
}
