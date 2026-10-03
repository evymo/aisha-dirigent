/**
 * Workbench drainer — the CONSUMER side of the PR-J workbench execution rail.
 *
 * `svc-ai-chat`'s workbenchAdapter enqueues a clow (`enqueue_workbench_request`)
 * and block-polls for its result. This module is what drains that queue: on an
 * interval it CLAIMS the oldest pending request (`claim_pending_workbench_requests`),
 * runs it on the developer's LOCAL model, and posts the outcome back
 * (`complete_workbench_request`). Without this loop every enqueued request sits
 * `pending` until the adapter times out — the rail is enqueue-only and dormant.
 *
 * The claim→run→complete ORDER + the "every claim is completed" invariant live in
 * the platform-agnostic {@link WorkbenchDrainer} engine (@aisha/workbench-core).
 * This file supplies the two concrete ports: a PostgREST-RPC queue and a
 * local-model runner.
 *
 * Fail-closed: the loop only claims work when the developer has opted in
 * (`aisha.dirigent.workbenchDrainer`), is authenticated, AND a local model is
 * actually discovered — so it never claims a request it cannot run. The one race
 * (a model vanishing between the guard and the run) is handled by completing the
 * request as `failed`, never leaving it stuck `claimed`.
 *
 * @module
 */

import * as vscode from "vscode";
import {
  WorkbenchDrainer,
  type WorkbenchQueuePort,
  type WorkbenchRunner,
  type WorkbenchCompletion,
  type WorkbenchExecutionRequest,
  type WorkbenchRunOutput,
  type WorkbenchDrainEvent,
  type CompleteWorkbenchResult,
} from "@aisha/workbench-core";

import { callRpc } from "./backend-rpc";
import { localChat, type ChatMessage } from "./local-llm-client";
import { resolveEdgeTarget } from "./compute-tier";
import { getAuthState } from "./auth";
import { safeError } from "./safe-logger";

/** How often to poll the queue while opted-in + focused. */
const POLL_INTERVAL_MS = 4_000;
/** Requests to claim per cycle (one editor = one local model = serial). */
const BATCH_LIMIT = 1;
/**
 * Bounded retry for a transient complete() failure. complete_workbench_request is
 * idempotent (its status guard makes a re-post a no-op), so retrying is safe and
 * avoids discarding a successful local run over one gateway blip / token refresh.
 */
const COMPLETE_MAX_ATTEMPTS = 3;
const COMPLETE_RETRY_MS = 500;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let drainTimer: ReturnType<typeof setInterval> | null = null;
/** Re-entrancy guard so a slow local run can't overlap the next tick. */
let draining = false;

/** Raised when the local model disappeared between the guard and the run. */
class WorkbenchEdgeUnavailableError extends Error {
  constructor() {
    super("workbench_edge_unavailable");
    this.name = "WorkbenchEdgeUnavailableError";
  }
}

/** True when the developer opted the extension in as a workbench executor. */
function isDrainerEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("aisha.dirigent")
    .get<boolean>("workbenchDrainer", false);
}

/**
 * PostgREST-RPC-backed queue port. Uses the extension's authenticated RPC
 * transport to call the workbench queue's DB functions.
 */
export class RpcWorkbenchQueue implements WorkbenchQueuePort {
  constructor(private readonly sessionId: string) {}

  async claim(limit: number): Promise<WorkbenchExecutionRequest[]> {
    // callRpc / api.rpc never throw — a failed claim returns { data: null, error }.
    // Throw on error so the engine's claim-phase telemetry fires instead of the
    // failure looking identical to "no pending work" (silent).
    const { data, error } = await callRpc<WorkbenchExecutionRequest[]>(
      "claim_pending_workbench_requests",
      { p_limit: limit, p_session_id: this.sessionId },
    );
    if (error) throw new Error(`workbench_claim_failed: ${error}`);
    return data ?? [];
  }

  async complete(completion: WorkbenchCompletion): Promise<void> {
    const params = {
      p_error: completion.error ?? null,
      p_latency_ms: completion.latencyMs ?? null,
      p_ok: completion.ok,
      p_output: completion.output,
      p_request_id: completion.requestId,
      p_tokens_in: completion.tokensIn ?? null,
      p_tokens_out: completion.tokensOut ?? null,
    };

    // callRpc never throws, so a transient failure here (gateway 5xx, a token
    // that expired during the local run) would otherwise be reported as SUCCESS
    // while the row stays 'claimed' and the run's result is silently lost. Retry
    // the idempotent RPC, then fail loud so the engine records a complete-phase
    // error — never drop a completed run's result silently.
    let lastError: string | null = null;
    for (let attempt = 0; attempt < COMPLETE_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(COMPLETE_RETRY_MS * attempt);
      const { error } = await callRpc<CompleteWorkbenchResult>("complete_workbench_request", params);
      if (!error) return;
      lastError = error;
    }
    throw new Error(`workbench_complete_failed: ${lastError ?? "unknown"}`);
  }
}

/** Runs a claimed request on the developer's local model. */
export class EdgeWorkbenchRunner implements WorkbenchRunner {
  async run(request: WorkbenchExecutionRequest): Promise<WorkbenchRunOutput> {
    const target = resolveEdgeTarget();
    if (!target) {
      // The model vanished after the pre-claim guard — surface it so the engine
      // marks the request `failed` (the producer sees it instead of timing out).
      throw new WorkbenchEdgeUnavailableError();
    }

    const result = await localChat({
      endpoint: target.endpoint,
      model: target.model,
      messages: buildMessages(request),
    });
    if (!result) {
      throw new Error("workbench_local_model_error");
    }

    return {
      output: result.content,
      tokensIn: result.tokens.promptTokens,
      tokensOut: result.tokens.completionTokens,
    };
  }
}

/** Build the chat messages for a claimed request from its clow + input. */
function buildMessages(request: WorkbenchExecutionRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const system = request.clow?.system_prompt ?? deriveSystemPrompt(request);
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: request.request_input });
  return messages;
}

/** A minimal system preamble from the clow descriptor when none is provided. */
function deriveSystemPrompt(request: WorkbenchExecutionRequest): string | null {
  const purpose = request.clow?.purpose;
  return purpose ? `You are an AISHA workbench executor. Purpose: ${purpose}.` : null;
}

/**
 * Start the workbench drain loop. Registers a disposable that stops the timer on
 * extension deactivate. Safe to call once from activate().
 */
export function startWorkbenchDrainer(context: vscode.ExtensionContext): void {
  const sessionId = `vscode-${vscode.env.sessionId}`;
  const drainer = new WorkbenchDrainer(
    new RpcWorkbenchQueue(sessionId),
    new EdgeWorkbenchRunner(),
    { batchLimit: BATCH_LIMIT, onEvent: reportEvent },
  );

  drainTimer = setInterval(() => void tick(drainer), POLL_INTERVAL_MS);

  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (drainTimer) {
        clearInterval(drainTimer);
        drainTimer = null;
      }
    }),
  );
}

/** One poll tick — fail-closed guards, then a single drain cycle. */
async function tick(drainer: WorkbenchDrainer): Promise<void> {
  if (draining) return; // a previous local run is still in flight
  // Only claim work we are configured, authorized, and able to run locally.
  if (!isDrainerEnabled()) return;
  if (!getAuthState().accessToken) return;
  if (!vscode.window.state.focused) return;
  if (!resolveEdgeTarget()) return; // no local model → leave requests for others

  draining = true;
  try {
    await drainer.drainOnce();
  } finally {
    draining = false;
  }
}

/** Surface failed runs; successful drains stay quiet (they are the norm). */
function reportEvent(event: WorkbenchDrainEvent): void {
  if (event.kind === "error") {
    safeError("workbench-drainer", `queue ${event.phase} error`, event.error);
  } else if (event.kind === "failed") {
    safeError("workbench-drainer", `request ${event.requestId} failed`, event.error);
  }
}
