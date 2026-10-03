/**
 * read-pipeline.ts — the ONE read pipeline every source read goes through
 * (extracted from svc-source-broker's source-read.ts serve()). A driver only
 * implements readOne/readBatch; the pipeline owns resolveBinding → capability
 * check → drift-gate → cache-first → driver call → BLOCKING audit. Live and batch
 * reads share this — no more per-path reimplementation of cross-cutting concerns.
 *
 * All I/O is injected (resolveBinding / audit / cache / clock) so the pipeline is
 * unit-testable with fakes — no broker, no DB, no network.
 */
import type {
  ReadDriver, ReadRequest, CallerScope, ScopedRecord, SourceConnection, SourceContract,
} from '@aisha/audience-types';

export interface ReadPipelineDeps {
  /** Resolve the story-spine binding for this read; null when unconfigured/unapproved. */
  resolveBinding(storyId: string, endpointRole: string): Promise<SourceConnection | null>;
  /** BLOCKING v2-hashed audit of a read (area='source_read'); throws to fail the read. */
  auditRead(entry: {
    storyId: string; entityType: string; externalId: string; caller: CallerScope; allowed: boolean;
  }): Promise<void>;
  /** Optional cache-first layer (one impl, shared by live + batch). */
  cache?: {
    get(key: string): ScopedRecord<unknown> | undefined;
    set(key: string, val: ScopedRecord<unknown>): void;
  };
  /** Contract drift gate — throw ReadDriftError to refuse the read (defaults to a no-op). */
  assertContract?(contract: SourceContract, conn: SourceConnection): Promise<void>;
  endpointRole?: string; // default 'source-api'
}

export class ReadDeniedError extends Error {
  constructor(public reason: 'not_configured' | 'unapproved' | 'unsupported', message: string) {
    super(message);
    this.name = 'ReadDeniedError';
  }
}

/**
 * Run a caller-scoped single read through the full pipeline. `storyId` keys the
 * spine binding; the driver never sees credentials, only the resolved connection.
 */
export async function runRead<TRec = unknown>(
  deps: ReadPipelineDeps,
  storyId: string,
  driver: ReadDriver<TRec>,
  req: ReadRequest,
  caller: CallerScope,
): Promise<ScopedRecord<TRec>> {
  const endpointRole = deps.endpointRole ?? 'source-api';

  // 1) capability — refuse a mode the driver doesn't advertise.
  if (!driver.config.capabilities?.length) {
    throw new ReadDeniedError('unsupported', `source ${driver.config.slug} advertises no capabilities`);
  }

  // 2) resolve the binding from the story spine (fail-closed: null => denied).
  const conn = await deps.resolveBinding(storyId, endpointRole);
  if (!conn) {
    throw new ReadDeniedError('not_configured', `no approved '${endpointRole}' binding for story ${storyId}`);
  }

  // 3) cache-first (shared TtlCache in prod).
  const cacheKey = `${storyId}:${req.entityType}:${req.externalId}:${caller.userId}`;
  const cached = deps.cache?.get(cacheKey);
  if (cached) return cached as ScopedRecord<TRec>;

  // 4) drift-gate BEFORE any read (universal — catches silent source schema drift).
  if (deps.assertContract) await deps.assertContract(driver.describeContract(), conn);

  // 5) the driver read (source-native).
  const result = await driver.readOne(req, conn, caller);

  // 6) BLOCKING audit — the read is not "done" until it is provably recorded.
  await deps.auditRead({
    storyId, entityType: req.entityType, externalId: req.externalId, caller,
    allowed: result.record !== null,
  });

  deps.cache?.set(cacheKey, result as ScopedRecord<unknown>);
  return result;
}
