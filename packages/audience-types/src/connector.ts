/**
 * connector.ts — the universal connector contracts (AISHA connector doctrine).
 *
 * A connector = a THIN driver over a THICK inherited chassis. These four shapes
 * are the ONLY things a per-source driver implements; everything cross-cutting
 * (auth, DB-resolved binding + rotation, approval gate, cache, drift refusal,
 * cursor/breaker, SSRF, federated caller_id, v2-hashed audit) is owned by
 * @aisha/broker-kit + the DB substrate and inherited.
 *
 *   READ      → ReadDriver<TRec>     (pull, SOURCE-NATIVE records)
 *   MAP       → SourceMapper<TRec>   (native rec → a named gated UpsertCommand)
 *   WRITE-BACK→ IControlTarget       (drive the external system AS the operator)
 *   GOVERN    → SourceConnection     (the DB-resolved binding every method takes)
 *
 * Records are SOURCE-NATIVE end to end. Aisha-shape translation lives ONLY in the
 * SourceMapper — which is why a vehicle source is never coupled to the audience
 * domain (the mistake that made IDataSource.fetchAggregateSnapshots dead).
 *
 * Dispatch is BY STORY through one registry that serves read + control + the
 * scheduler tick — fusing the two seams that were disconnected before.
 */

import type { MemberTier } from './member-tier.js';
import type { DataSourceConfig, SourceConnection, ProbeResult, ChangeEvent } from './IDataSource.js';

// ----------------------------------------------------------------------------
// Requests + scoped results (source-native)
// ----------------------------------------------------------------------------

/** A single-entity read (generalizes getEntity). */
export interface ReadRequest {
  entityType: string;
  externalId: string;
}

/** A batch/stream read; cursor/since carried here (generalizes fetchAggregateSnapshots). */
export interface BatchReadRequest {
  entityType: string;
  since?: string; // ISO 8601
  cursor?: string;
  limit?: number;
}

/** The federated caller a read/control is performed AS (source-side scope). */
export interface CallerScope {
  userId: string;
  tier?: MemberTier;
  /** The external identity to act as, resolved via federated_caller_for(provider, userId). */
  federatedCallerId?: string;
}

/** A source-native record scoped to the caller — the driver never returns aisha shapes. */
export interface ScopedRecord<TRec = unknown> {
  record: TRec | null;
  caller: CallerScope;
  allowedReason: string;
}

// ----------------------------------------------------------------------------
// Contract / drift (transport-agnostic — NOT Postgres-specific)
// ----------------------------------------------------------------------------

export interface SourceField {
  name: string;
  type: string;
  required: boolean;
}

/** The consumer-driven contract a driver declares, fed to the universal drift gate. */
export interface SourceContract {
  name: string;
  /** For pg: table+columns. For REST/GraphQL: response schema. Transport-agnostic. */
  fields: SourceField[];
}

/** Transport-agnostic health (each driver contributes one healthCheck). */
export type SourceHealth = ProbeResult;

// ----------------------------------------------------------------------------
// READ driver — the ONLY per-source read code (source-native)
// ----------------------------------------------------------------------------

export interface ReadDriver<TRec = unknown> {
  readonly config: DataSourceConfig;

  /** Open/validate; fail-fast on bad config. The binding is passed per read (rotation-safe). */
  initialize(conn?: SourceConnection): Promise<void>;

  /** The drift-canary input — verified by the pipeline BEFORE any read. */
  describeContract(): SourceContract;

  /** Live single read, caller-scoped. Generalizes getEntity; emits a SOURCE-NATIVE record. */
  readOne(req: ReadRequest, conn: SourceConnection, caller: CallerScope): Promise<ScopedRecord<TRec>>;

  /** Batch/stream read. Generalizes fetchAggregateSnapshots; cursor/since in req; SOURCE-NATIVE. */
  readBatch(req: BatchReadRequest, conn: SourceConnection): AsyncIterable<TRec>;

  /** CDC/stream — ONLY if config.capabilities includes 'cdc-stream'. */
  subscribe?(req: ReadRequest, conn: SourceConnection): AsyncIterable<ChangeEvent>;

  probe(conn?: SourceConnection): Promise<ProbeResult>;
  shutdown(): Promise<void>;
}

// ----------------------------------------------------------------------------
// MAP — source-native record → a named, gated upsert (the ONLY aisha-shape site)
// ----------------------------------------------------------------------------

/** A named gated write the ingest engine calls via PostgREST /rpc/<rpc>. */
export interface UpsertCommand {
  /** The gated SECURITY DEFINER RPC name, e.g. 'hub_upsert_vehicle_cache'. */
  rpc: string;
  payload: Record<string, unknown>;
}

export type SourceMapper<TRec = unknown> = (rec: TRec) => UpsertCommand;

// ----------------------------------------------------------------------------
// WRITE-BACK / CONTROL — drive the external system AS the federated operator
// ----------------------------------------------------------------------------

/** The kinds of control actions a target advertises (e.g. 'price.put', 'order.place'). */
export type ControlCapability = string;

export interface ControlAction {
  kind: ControlCapability;
  payload: Record<string, unknown>;
  /** Idempotency across the read→external-write→hub-record saga; retries never double-write. */
  idempotencyKey: string;
}

export interface ControlResult {
  ok: boolean;
  /** The external system's reference for the executed action (e.g. an order id). */
  externalRef?: string;
  detail?: string;
}

/** The write twin of ReadDriver — dispatched through the SAME registry. */
export interface IControlTarget {
  readonly config: DataSourceConfig;
  initialize(conn?: SourceConnection): Promise<void>;
  /** Which action kinds are real (the pipeline refuses kinds not advertised). */
  capabilities(): ControlCapability[];
  /** Execute one action AS the federated caller; maps action.kind → one external RPC. */
  execute(action: ControlAction, conn: SourceConnection, caller: CallerScope): Promise<ControlResult>;
  probe(conn?: SourceConnection): Promise<ProbeResult>;
  shutdown(): Promise<void>;
}

// ----------------------------------------------------------------------------
// Registry — one story-indexed dispatch for read + control + the scheduler tick
// ----------------------------------------------------------------------------

export interface ConnectorRegistryEntry {
  storyId: string;
  slug: string;
  kinds: Array<'read' | 'control'>;
  lastHealth?: ProbeResult['status'];
}

export interface ConnectorRegistry {
  registerReader(storyId: string, driver: ReadDriver): void;
  registerControl(storyId: string, target: IControlTarget): void;
  /** The read/scheduler dispatch key; undefined when no reader is bound to the story. */
  getReaderForStory(storyId: string): ReadDriver | undefined;
  /** The control dispatch key; undefined when no control target is bound to the story. */
  getControlForStory(storyId: string): IControlTarget | undefined;
  list(): ConnectorRegistryEntry[];
}
