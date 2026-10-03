/**
 * @aisha/acs-contracts — contract registry source of truth.
 *
 * JSON Schema files in ../schemas are the canonical artefacts (diffable,
 * versioned, seedable into acs_message_schemas). This module loads them via
 * createRequire so ESM consumers need no import-assertion flags.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Message-type reference: name@major.minor (see envelope.schema pattern). */
export type SchemaRef =
  | 'acs.envelope@1.0'
  | 'acs.task.assign@1.0'
  | 'acs.task.result@1.0'
  | 'acs.effect.propose@1.0'
  | 'acs.effect.decision@1.0'
  | 'acs.verify.request@1.0'
  | 'acs.verify.result@1.0'
  | 'acs.event.db_change@1.0'
  | 'acs.workflow.graph@1.0';

export const SCHEMA_REFS: readonly SchemaRef[] = [
  'acs.envelope@1.0',
  'acs.task.assign@1.0',
  'acs.task.result@1.0',
  'acs.effect.propose@1.0',
  'acs.effect.decision@1.0',
  'acs.verify.request@1.0',
  'acs.verify.result@1.0',
  'acs.event.db_change@1.0',
  'acs.workflow.graph@1.0',
] as const;

/** JSON Schema document (draft 2020-12) as a plain object. */
export type JsonSchemaDocument = Record<string, unknown>;

const cache = new Map<SchemaRef, JsonSchemaDocument>();

/** Load one schema document by ref. Throws on unknown ref — reject, don't coerce. */
export function getSchema(ref: SchemaRef): JsonSchemaDocument {
  const hit = cache.get(ref);
  if (hit) return hit;
  if (!SCHEMA_REFS.includes(ref)) {
    throw new Error(`acs-contracts: unknown schema ref "${String(ref)}"`);
  }
  const doc = require(`../schemas/${ref}.json`) as JsonSchemaDocument;
  cache.set(ref, doc);
  return doc;
}

/** All schemas keyed by ref — used by the DB seed and by ajv preloading. */
export function getAllSchemas(): ReadonlyMap<SchemaRef, JsonSchemaDocument> {
  for (const ref of SCHEMA_REFS) getSchema(ref);
  return cache;
}

// ---------------------------------------------------------------------------
// Typed payload shapes (hand-maintained mirror of the schemas; contract tests
// keep them honest). Control-plane fields are closed unions — never string.
// ---------------------------------------------------------------------------

export type SourceClass = 'internal' | 'partner' | 'byod' | 'public';

export interface EnvelopeTrust {
  source_class: SourceClass;
  derived: boolean;
  source_ref: string | null;
}

export interface Envelope {
  message_id: string;
  schema: Exclude<SchemaRef, 'acs.envelope@1.0'>;
  intent_id: string;
  correlation_id: string;
  causation_id: string | null;
  sender: string;
  recipient: string;
  sent_at: string;
  signature: string | null;
  trust: EnvelopeTrust;
}

export interface AcsMessage<P extends object = Record<string, unknown>> {
  envelope: Envelope;
  payload: P;
}

export type RefKind = 'intent' | 'message' | 'document' | 'kb_chunk' | 'run' | 'effect';
export interface InputRef { kind: RefKind; id: string }
export type Priority = 'p0' | 'p1' | 'p2' | 'p3';

export interface TaskAssignPayload {
  task_kind: string;
  intent_ref: string;
  input_refs: InputRef[];
  priority: Priority;
  constraints?: {
    deadline?: string;
    max_tokens?: number;
    budget_units?: number;
    allowed_tools?: string[];
  };
}

export type TaskStatus = 'completed' | 'failed' | 'partial' | 'aborted';
export type DerivationMethod = 'summary' | 'extraction' | 'translation' | 'synthesis' | 'verbatim' | null;

export interface TaskResultPayload {
  status: TaskStatus;
  intent_ref: string;
  output_ref: { kind: 'message' | 'document' | 'run' | 'artifact'; id: string } | null;
  provenance?: { derived: boolean; source_ref: string | null; method: DerivationMethod };
  metrics: { duration_ms: number; tokens_in?: number; tokens_out?: number };
  error?: { code: string; message?: string } | null;
}

export type EffectClass = 'write' | 'delete' | 'payment' | 'deploy' | 'external_call' | 'unclassified';

export interface EffectProposePayload {
  effect_id: string;
  tool_name: string;
  effect_class: EffectClass;
  intent_ref: string;
  proposal: { target: string; action: string; params_sha256: string; summary?: string };
}

export interface EffectDecisionPayload {
  effect_id: string;
  decision: 'confirm' | 'abort';
  decided_by: 'constraint_check' | 'acl' | 'operator' | 'budget_gate';
  params_sha256: string;
  reason_code?: string | null;
}

export interface VerifyRequestPayload {
  intent_ref: string;
  output_ref: { kind: 'message' | 'document' | 'run' | 'artifact'; id: string };
  trigger: 'effect' | 'sampled_read_only' | 'operator';
  tot_context?: { winning_thought_id: string; depth: number } | null;
}

export type Verdict = 'pass' | 'fail' | 'insufficient_evidence';

export interface VerifyResultPayload {
  intent_ref: string;
  verdict: Verdict;
  drift_score: number;
  findings?: Array<{ code: string; severity: 'info' | 'warning' | 'violation'; detail?: string }>;
}

export interface DbChangePayload {
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  row_ref: { schema: string; table: string; pk: string };
  occurred_at: string;
}
