/**
 * Workbench execution-queue contract — the shared SoT for the PR-J "workbench"
 * runtime rail.
 *
 * The rail is a POLL+BLOCK work queue: `svc-ai-chat` enqueues a unit of work
 * (`enqueue_workbench_request`) and block-polls for its result
 * (`fetch_workbench_result`), while the AISHA Dirigent editor extension CLAIMS
 * the oldest pending request (`claim_pending_workbench_requests`), runs it on a
 * LOCAL model, and posts the result back (`complete_workbench_request`).
 *
 * These types mirror the `public.workbench_execution_requests` table + the RPC
 * signatures 1:1 so the producer (svc-ai-chat) and the consumer (extension /
 * workbench fork) speak ONE contract. Keeping them in the platform-agnostic
 * core means neither side re-declares the row shape or the param order.
 *
 * @module
 */

/** Lifecycle of a queued request. Mirrors the table's `status` CHECK. */
export type WorkbenchRequestStatus = "pending" | "claimed" | "completed" | "failed";

/**
 * The clow descriptor the producer enqueues (jsonb). Open-ended — the resolver
 * decided this clow runs on the workbench runtime, so the consumer treats it as
 * execution context (a few hints are named; the rest is passed through).
 */
export interface WorkbenchClow {
  /** Why this clow exists (e.g. "evaluate_story", "recap"). */
  purpose?: string;
  /** Clow type/kind, when the producer sets one. */
  type?: string;
  /** Optional system/instruction preamble for the local model. */
  system_prompt?: string;
  [key: string]: unknown;
}

/**
 * One row of `public.workbench_execution_requests` as returned by
 * `claim_pending_workbench_requests` (RETURNS SETOF the table). Field names
 * match the columns exactly.
 */
export interface WorkbenchExecutionRequest {
  id: string;
  clow: WorkbenchClow | null;
  /** The prompt / task text (`request_input` column, `p_input` on enqueue). */
  request_input: string;
  model_id: string | null;
  provider_slug: string | null;
  run_id: string | null;
  story_id: string | null;
  decision_id: string | null;
  status: WorkbenchRequestStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  enqueued_at: string;
}

/** Params for `claim_pending_workbench_requests` (alphabetical — rpc-params gate). */
export interface ClaimPendingWorkbenchParams {
  p_limit: number;
  p_session_id: string | null;
}

/** Params for `complete_workbench_request` (alphabetical — rpc-params gate). */
export interface CompleteWorkbenchParams {
  p_error: string | null;
  p_latency_ms: number | null;
  p_ok: boolean;
  p_output: string | null;
  p_request_id: string;
  p_tokens_in: number | null;
  p_tokens_out: number | null;
}

/** Result shape returned by `complete_workbench_request`. */
export interface CompleteWorkbenchResult {
  request_id: string;
  status?: WorkbenchRequestStatus;
  updated: boolean;
}
