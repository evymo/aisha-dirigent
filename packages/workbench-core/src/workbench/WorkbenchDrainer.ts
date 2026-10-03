/**
 * WorkbenchDrainer — the platform-agnostic claim→run→complete loop for the PR-J
 * workbench rail.
 *
 * This is the reusable engine the AISHA Dirigent extension AND the AISHA
 * Workbench fork build on: it owns the ORDER of operations (claim a batch, run
 * each request on a local model, post every outcome back) and the invariant
 * that EVERY claimed request is completed — on success OR failure — so the
 * producer's block-poll never hangs waiting on a request this consumer already
 * gave up on.
 *
 * It is transport- and model-agnostic: the caller supplies two ports —
 *   • {@link WorkbenchQueuePort}  — how to CLAIM pending rows + POST a result
 *     (e.g. PostgREST RPC in the extension).
 *   • {@link WorkbenchRunner}     — how to RUN a claimed request on a local
 *     model (e.g. an OpenAI-compatible local endpoint).
 *
 * The engine deliberately holds NO timers and NO network code, so it is trivial
 * to unit-test and can be driven by any scheduler (a VS Code setInterval, a
 * server poller, a test that calls {@link drainOnce} once).
 *
 * @module
 */

import type { WorkbenchExecutionRequest } from "./types.js";

/** A completed outcome to post back for one claimed request. */
export interface WorkbenchCompletion {
  requestId: string;
  ok: boolean;
  output: string | null;
  error?: string | null;
  latencyMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
}

/** Port: claim pending requests + post a result. Transport-agnostic. */
export interface WorkbenchQueuePort {
  /** Atomically claim up to `limit` oldest pending requests (now `claimed`). */
  claim(limit: number): Promise<WorkbenchExecutionRequest[]>;
  /** Post a request's result (idempotent on the DB side). */
  complete(completion: WorkbenchCompletion): Promise<void>;
}

/** The textual output + token accounting from running a request locally. */
export interface WorkbenchRunOutput {
  output: string;
  tokensIn?: number | null;
  tokensOut?: number | null;
}

/** Port: run a claimed request on a local model. */
export interface WorkbenchRunner {
  /**
   * Execute one claimed request. Resolve with the model output; THROW to signal
   * a failed run (the drainer records the thrown message as the failure detail
   * and marks the request `failed` — never leaves it stuck `claimed`).
   */
  run(request: WorkbenchExecutionRequest): Promise<WorkbenchRunOutput>;
}

/** Phase a drainer error occurred in (for observability callbacks). */
export type WorkbenchDrainPhase = "claim" | "run" | "complete";

export interface WorkbenchDrainerOptions {
  /** How many requests to claim per drain cycle. Default 1. */
  batchLimit?: number;
  /** Observability hook — called for each processed request + on errors. */
  onEvent?: (event: WorkbenchDrainEvent) => void;
  /**
   * Monotonic clock, injectable for tests. Defaults to a best-effort
   * `performance.now()` / `Date.now()`; `null` disables latency measurement.
   */
  now?: (() => number) | null;
}

/** Structured drainer telemetry. */
export type WorkbenchDrainEvent =
  | { kind: "completed"; requestId: string; latencyMs: number | null }
  | { kind: "failed"; requestId: string; error: string; latencyMs: number | null }
  | { kind: "error"; phase: WorkbenchDrainPhase; error: string; requestId?: string };

/** Best-effort monotonic clock — `performance` may be absent in some runtimes. */
function defaultNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export class WorkbenchDrainer {
  private readonly batchLimit: number;
  private readonly onEvent?: (event: WorkbenchDrainEvent) => void;
  private readonly now: (() => number) | null;

  constructor(
    private readonly queue: WorkbenchQueuePort,
    private readonly runner: WorkbenchRunner,
    options: WorkbenchDrainerOptions = {},
  ) {
    this.batchLimit = Math.max(1, options.batchLimit ?? 1);
    this.onEvent = options.onEvent;
    this.now = options.now === undefined ? defaultNow : options.now;
  }

  /**
   * Run ONE drain cycle: claim a batch, then run+complete each request. Never
   * throws — a claim failure returns 0; a per-request failure is posted back as
   * a `failed` completion and does not stop the rest of the batch.
   *
   * @returns the number of requests whose outcome was posted back.
   */
  async drainOnce(): Promise<number> {
    let claimed: WorkbenchExecutionRequest[];
    try {
      claimed = await this.queue.claim(this.batchLimit);
    } catch (err) {
      this.emit({ kind: "error", phase: "claim", error: errMessage(err) });
      return 0;
    }

    let processed = 0;
    for (const request of claimed) {
      if (await this.process(request)) processed += 1;
    }
    return processed;
  }

  /** Run + complete a single claimed request. Returns true if a result posted. */
  private async process(request: WorkbenchExecutionRequest): Promise<boolean> {
    const started = this.now ? this.now() : null;
    let completion: WorkbenchCompletion;

    try {
      const result = await this.runner.run(request);
      completion = {
        requestId: request.id,
        ok: true,
        output: result.output,
        latencyMs: this.elapsed(started),
        tokensIn: result.tokensIn ?? null,
        tokensOut: result.tokensOut ?? null,
      };
    } catch (runErr) {
      // The run failed — mark the request `failed` so the producer's block-poll
      // sees the outcome instead of timing out. Fail-loud, never silent.
      completion = {
        requestId: request.id,
        ok: false,
        output: null,
        error: errMessage(runErr),
        latencyMs: this.elapsed(started),
      };
    }

    try {
      await this.queue.complete(completion);
    } catch (completeErr) {
      this.emit({ kind: "error", phase: "complete", requestId: request.id, error: errMessage(completeErr) });
      return false;
    }

    this.emit(
      completion.ok
        ? { kind: "completed", requestId: request.id, latencyMs: completion.latencyMs ?? null }
        : { kind: "failed", requestId: request.id, error: completion.error ?? "workbench_run_failed", latencyMs: completion.latencyMs ?? null },
    );
    return true;
  }

  private elapsed(started: number | null): number | null {
    if (started === null || !this.now) return null;
    return Math.round(this.now() - started);
  }

  private emit(event: WorkbenchDrainEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // observability must never break the drain loop — event sink errors are
      // intentionally suppressed so a bad listener can't stall the workbench
    }
  }
}
