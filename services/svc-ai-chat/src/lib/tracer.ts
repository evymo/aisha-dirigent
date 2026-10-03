/**
 * AI Observability Tracer for Edge Functions
 *
 * Provides structured tracing of AI pipeline steps (LLM calls, routing decisions,
 * context composition, etc.) persisted to `ai_runs` + `ai_trace_events` via RPCs.
 *
 * Usage:
 *   import { createTracer, type AiEventType } from "../_shared/tracer.ts";
 *
 *   const tracer = await createTracer(pgrestService, { kind: "chat", actorUserId: userId });
 *
 *   const result = await tracer.span("llm_call", "classify", "openai", "responses.create", async () => {
 *     const res = await openai.responses.create({ ... });
 *     tracer.addTokens(res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
 *     return res;
 *   });
 *
 *   await tracer.finish("succeeded");
 *
 * @module
 */

import type { PostgrestClient } from './rpcAdapter.js';

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
// ---------------------------------------------------------------------------
// Langfuse dual-write (optional — active when LANGFUSE_HOST is configured)
// ---------------------------------------------------------------------------

interface LangfuseEvent {
  id: string;
  type: string;
  body: Record<string, unknown>;
  timestamp: string;
}

/**
 * Lightweight Langfuse writer that buffers trace events and flushes them
 * as a single batch to Langfuse's `/api/public/ingestion` REST API.
 *
 * Activated only when LANGFUSE_HOST + LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY
 * environment variables are all set. Fire-and-forget — never blocks the pipeline.
 */
class LangfuseWriter {
  private events: LangfuseEvent[] = [];
  private readonly host: string;
  private readonly authHeader: string;
  readonly traceId: string;

  constructor(host: string, publicKey: string, secretKey: string) {
    this.host = host.replace(/\/+$/, "");
    this.authHeader = "Basic " + btoa(`${publicKey}:${secretKey}`);
    this.traceId = crypto.randomUUID();
  }

  /** Create the initial trace event. */
  createTrace(name: string, metadata?: Record<string, unknown>): void {
    this.events.push({
      id: crypto.randomUUID(),
      type: "trace-create",
      body: {
        id: this.traceId,
        name,
        metadata: metadata ?? {},
      },
      timestamp: new Date().toISOString(),
    });
  }

  /** Buffer a span/generation event. */
  addGeneration(
    name: string,
    model: string,
    durationMs: number,
    status: string,
    inputTokens?: number,
    outputTokens?: number,
    metadata?: Record<string, unknown>,
  ): void {
    this.events.push({
      id: crypto.randomUUID(),
      type: "generation-create",
      body: {
        traceId: this.traceId,
        name,
        model: model || undefined,
        startTime: new Date(Date.now() - (durationMs || 0)).toISOString(),
        endTime: new Date().toISOString(),
        completionStartTime: new Date().toISOString(),
        usage: (inputTokens || outputTokens)
          ? { input: inputTokens ?? 0, output: outputTokens ?? 0 }
          : undefined,
        level: status === "error" ? "ERROR" : "DEFAULT",
        statusMessage: status,
        metadata: metadata ?? {},
      },
      timestamp: new Date().toISOString(),
    });
  }

  /** Buffer a generic span event. */
  addSpan(
    name: string,
    durationMs: number,
    status: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.events.push({
      id: crypto.randomUUID(),
      type: "span-create",
      body: {
        traceId: this.traceId,
        name,
        startTime: new Date(Date.now() - (durationMs || 0)).toISOString(),
        endTime: new Date().toISOString(),
        level: status === "error" ? "ERROR" : "DEFAULT",
        statusMessage: status,
        metadata: metadata ?? {},
      },
      timestamp: new Date().toISOString(),
    });
  }

  /** Update the trace with final status. */
  updateTrace(status: string, metadata?: Record<string, unknown>): void {
    this.events.push({
      id: crypto.randomUUID(),
      type: "trace-create",
      body: {
        id: this.traceId,
        metadata: { ...metadata, finalStatus: status },
      },
      timestamp: new Date().toISOString(),
    });
  }

  /** Flush all buffered events to Langfuse. Fire-and-forget. */
  async flush(): Promise<void> {
    if (this.events.length === 0) return;
    try {
      const resp = await fetch(`${this.host}/api/public/ingestion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": this.authHeader,
        },
        body: JSON.stringify({ batch: this.events }),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        log.safeWarn(`[tracer/langfuse] Flush failed (${resp.status}): ${(await resp.text()).substring(0, 200)}`);
      }
    } catch (err) {
      log.safeWarn("[tracer/langfuse] Flush exception", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** Create a LangfuseWriter if env is configured, otherwise null. */
function createLangfuseWriter(): LangfuseWriter | null {
  const host = process.env.LANGFUSE_HOST;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!host || !publicKey || !secretKey) return null;
  return new LangfuseWriter(host, publicKey, secretKey);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Allowed event types — kept in 1:1 sync with the `ai_event_type` enum in the
 * database (aisha/db/sql/enums/ai_event_type.sql), in the enum's declaration
 * order. Every value here MUST be a member of that enum: tracer.span()/event()
 * pass it to insert_ai_trace_event, which casts `p_event_type::ai_event_type`,
 * so a non-member throws 22P02 at the DB (and writeEvent swallows the error,
 * silently dropping the trace row). To add a new event type, ALTER TYPE the DB
 * enum first, then mirror it here.
 */
export type AiEventType =
  | "llm_call"
  | "mcp_call"
  | "tool_call"
  | "patch_applied"
  | "test_run"
  | "deploy"
  | "quality_gate"
  | "human_approval"
  | "route_decision"
  | "context_compose"
  | "compliance_check"
  | "evaluation"
  | "proactive_trigger"
  | "proactive_evaluation"
  | "scheduled_job"
  | "study_monitor"
  | "memory_read"
  | "memory_write"
  | "task_checkpoint"
  | "react_thought"
  | "workflow_start"
  | "workflow_node"
  | "workflow_transition"
  | "parallel_fanout"
  | "critic_review"
  | "dirigent_action"
  | "n8n_workflow"
  | "escalation"
  | "notification"
  | "moderation_decision"
  | "improvement_proposal"
  | "route_plan_override"
  | "route_plan_classify_bypass"
  | "dev_signal";

/**
 * Allowed run statuses matching the `ai_runs.status` CHECK constraint.
 */
export type AiRunStatus = "running" | "succeeded" | "failed" | "canceled" | "blocked";

/**
 * Allowed run kinds matching the `ai_runs.kind` CHECK constraint.
 */
export type AiRunKind =
  | "chat"
  | "project_delivery"
  | "compliance_check"
  | "guild_review"
  | "pr_gate"
  | "incident"
  | "doc_update"
  | "proactive"
  | "scheduled";

/**
 * Options for creating a new tracer (and thus a new AI run).
 */
export interface TracerOptions {
  /** The kind of AI run (maps to `ai_runs.kind`). */
  kind: AiRunKind;
  /** The user who triggered the run. */
  actorUserId?: string;
  /** Optional story / project ID. */
  storyId?: string;
  /** Optional route_plan JSON passed to `create_ai_run`. */
  routePlan?: Record<string, unknown>;
}

/**
 * Extra metadata that can be supplied when recording a span.
 */
export interface SpanMeta {
  /** Cost breakdown (e.g. `{ input_cost: 0.001, output_cost: 0.002 }`). */
  costJson?: Record<string, unknown>;
  /** Summary of the request sent to the provider. */
  requestSummary?: Record<string, unknown>;
  /** Summary of the provider response. */
  responseSummary?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function truncateJson(obj: unknown, maxKeys = 20): Record<string, unknown> | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  const entries = Object.entries(obj as Record<string, unknown>).slice(0, maxKeys);
  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

export interface Tracer {
  /** The `ai_runs.id` UUID for this run. `null` if creation failed. */
  readonly runId: string | null;

  /**
   * Wrap an async operation as a traced span.
   *
   * Automatically measures duration, captures errors, and inserts a trace event.
   * Returns the result of `fn` or re-throws on error (after recording the failure).
   */
  span<T>(
    eventType: AiEventType,
    agentSlug: string,
    provider: string,
    operation: string,
    fn: () => Promise<T>,
    meta?: SpanMeta,
  ): Promise<T>;

  /**
   * Record a point-in-time trace event (no wrapping of an operation).
   *
   * Overloads:
   * - Full form: `event(type, agent, provider, operation, status, durationMs?, meta?)`
   * - Short form (legacy workflow engine): `event(type, agent, meta)` — defaults
   *   provider="workflow", operation="event", status="ok".
   */
  event(
    eventType: AiEventType,
    agentSlug: string,
    provider: string,
    operation: string,
    status: "ok" | "error" | "timeout" | "skipped",
    durationMs?: number,
    meta?: SpanMeta & { errorJson?: Record<string, unknown> },
  ): Promise<void>;
  event(
    eventType: AiEventType,
    agentSlug: string,
    meta: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Accumulate token counts (called inside `span` callbacks).
   * The totals are available in `getTokens()` and stored in run metadata on `finish()`.
   */
  addTokens(input: number, output: number): void;

  /** Read accumulated token counters. */
  getTokens(): { input: number; output: number };

  /**
   * Finalize the run by calling `finish_ai_run`.
   * Aggregates cost from trace events on the DB side.
   */
  finish(status: AiRunStatus, metadata?: Record<string, unknown>): Promise<void>;
}

/**
 * Create a new tracer bound to a fresh `ai_runs` row.
 *
 * If the run creation RPC fails, the tracer degrades gracefully:
 * all write methods become no-ops so the calling pipeline is never blocked.
 */
export async function createTracer(
  pgrestService: PostgrestClient,
  options: TracerOptions,
): Promise<Tracer> {
  let runId: string | null = null;
  let tokensInput = 0;
  let tokensOutput = 0;
  const langfuse = createLangfuseWriter();

  // Create the run row
  try {
    const { data, error } = await pgrestService.rpc("create_ai_run", {
      p_actor_user_id: options.actorUserId ?? null,
      p_kind: options.kind,
      p_route_plan: options.routePlan ?? null,
    
      p_story_id: options.storyId ?? null,});

    if (error) {
      log.safeError("[tracer] Failed to create ai_run:", error.message);
    } else {
      runId = data as string;
      langfuse?.createTrace(`ai-run:${options.kind}`, {
        runId,
        kind: options.kind,
        actorUserId: options.actorUserId,
        storyId: options.storyId,
      });
    }
  } catch (err) {
    log.safeError("[tracer] create_ai_run exception:", err);
  }

  // Internal: write a trace event row
  async function writeEvent(
    eventType: AiEventType,
    agentSlug: string,
    provider: string,
    operation: string,
    status: "ok" | "error" | "timeout" | "skipped",
    durationMs?: number,
    meta?: SpanMeta & { errorJson?: Record<string, unknown> },
  ): Promise<void> {
    if (!runId) return; // degraded mode
    try {
      const { error } = await pgrestService.rpc("insert_ai_trace_event", {
        p_agent_slug: agentSlug || null,
        p_cost_json: meta?.costJson ? truncateJson(meta.costJson) : null,
        p_duration_ms: durationMs ?? null,
        p_error_json: meta?.errorJson ? truncateJson(meta.errorJson) : null,
      
        p_event_type: eventType,
        p_operation: operation || null,
        p_provider: provider || null,
        p_request_summary: meta?.requestSummary ? truncateJson(meta.requestSummary) : null,
        p_response_summary: meta?.responseSummary ? truncateJson(meta.responseSummary) : null,
        p_run_id: runId,
        p_status: status,});

      if (error) {
        log.safeError("[tracer] insert_ai_trace_event failed:", error.message);
      }

      // Dual-write to Langfuse (fire-and-forget)
      if (langfuse) {
        if (eventType === "llm_call") {
          langfuse.addGeneration(
            `${agentSlug}:${operation}`,
            provider,
            durationMs ?? 0,
            status,
            meta?.costJson?.input_tokens as number | undefined,
            meta?.costJson?.output_tokens as number | undefined,
            { eventType, agentSlug },
          );
        } else {
          langfuse.addSpan(
            `${eventType}:${agentSlug}:${operation}`,
            durationMs ?? 0,
            status,
            { eventType, agentSlug, provider },
          );
        }
      }
    } catch (err) {
      log.safeError("[tracer] insert_ai_trace_event exception:", err);
    }
  }

  const tracer: Tracer = {
    get runId() {
      return runId;
    },

    async span<T>(
      eventType: AiEventType,
      agentSlug: string,
      provider: string,
      operation: string,
      fn: () => Promise<T>,
      meta?: SpanMeta,
    ): Promise<T> {
      const t0 = Date.now();
      try {
        const result = await fn();
        const durationMs = Date.now() - t0;
        await writeEvent(eventType, agentSlug, provider, operation, "ok", durationMs, meta);
        return result;
      } catch (err) {
        const durationMs = Date.now() - t0;
        const errorJson: Record<string, unknown> = {
          message: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : "Unknown",
        };
        await writeEvent(eventType, agentSlug, provider, operation, "error", durationMs, {
          ...meta,
          errorJson,
        });
        throw err; // re-throw so the caller's error handling still works
      }
    },

    async event(
      eventType: AiEventType,
      agentSlug: string,
      providerOrMeta: string | Record<string, unknown>,
      operation?: string,
      status?: "ok" | "error" | "timeout" | "skipped",
      durationMs?: number,
      meta?: SpanMeta & { errorJson?: Record<string, unknown> },
    ): Promise<void> {
      // Legacy 3-arg form: event(type, agent, meta) — defaults provider/op/status
      if (typeof providerOrMeta !== "string") {
        await writeEvent(eventType, agentSlug, "workflow", "event", "ok", undefined, providerOrMeta as SpanMeta);
        return;
      }
      await writeEvent(eventType, agentSlug, providerOrMeta, operation ?? "event", status ?? "ok", durationMs, meta);
    },

    addTokens(input: number, output: number): void {
      tokensInput += input;
      tokensOutput += output;
    },

    getTokens() {
      return { input: tokensInput, output: tokensOutput };
    },

    async finish(status: AiRunStatus, metadata?: Record<string, unknown>): Promise<void> {
      if (!runId) return;
      try {
        const runMetadata: Record<string, unknown> = {
          ...metadata,
          total_tokens_input: tokensInput,
          total_tokens_output: tokensOutput,
        };

        const { error } = await pgrestService.rpc("finish_ai_run", {
          p_metadata: runMetadata,
        
          p_run_id: runId,
          p_status: status,});

        if (error) {
          log.safeError("[tracer] finish_ai_run failed:", error.message);
        }

        // Flush all buffered events to Langfuse
        if (langfuse) {
          langfuse.updateTrace(status, runMetadata);
          await langfuse.flush();
        }
      } catch (err) {
        log.safeError("[tracer] finish_ai_run exception:", err);
      }
    },
  };

  return tracer;
}

/**
 * Create a no-op tracer that silently discards all events.
 * Useful as a safe default before the real tracer is initialised.
 */
export function createNoopTracer(): Tracer {
  return {
    get runId() { return null; },
    async span<T>(
      _eventType: AiEventType,
      _agentSlug: string,
      _provider: string,
      _operation: string,
      fn: () => Promise<T>,
    ): Promise<T> {
      return fn();
    },
    async event(): Promise<void> { /* noop */ },
    addTokens(): void { /* noop */ },
    getTokens() { return { input: 0, output: 0 }; },
    async finish(): Promise<void> { /* noop */ },
  };
}
