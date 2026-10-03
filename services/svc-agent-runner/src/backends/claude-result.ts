/**
 * Result-format contract for a stack-launched Claude CLI instance.
 *
 * The agent-claude entrypoint emits a final machine-readable stdout line —
 *   {"__result":true,"value":{"ok":bool,"run_id":string,"exit_code":number}}
 * — and ClaudeCliBackend.parseLogs lifts `value` out as RunResult.result. Until
 * now that value was parsed then DISCARDED: the orchestration layer read only the
 * container exit code, so a run that exited 0 having emitted nothing (or garbage)
 * was recorded as `succeeded`. This module makes the result a real CONTRACT:
 * validate the sentinel, so "succeeded" means "produced a well-formed result", and
 * persist the structured value to agent_runs.outputs for downstream consumers.
 */

/** The validated sentinel value. */
export interface ClaudeRunResult {
  ok: boolean;
  run_id: string;
  exit_code: number;
}

export interface ValidatedResult {
  /** true iff the sentinel was present AND structurally valid. */
  valid: boolean;
  /** the parsed sentinel value when valid, else null. */
  value: ClaudeRunResult | null;
  /** why validation failed (surfaced as error_summary), else null. */
  reason: string | null;
}

/**
 * Validate the `__result` sentinel value parsed off the container's stdout.
 * Hand-rolled (svc-agent-runner carries no schema lib) — the shape is small and
 * fixed, and a guard keeps the dependency surface minimal.
 */
export function validateClaudeResult(raw: unknown): ValidatedResult {
  if (raw === undefined || raw === null) {
    return { valid: false, value: null, reason: 'no __result sentinel emitted by the agent' };
  }
  if (typeof raw !== 'object') {
    return { valid: false, value: null, reason: 'result sentinel is not an object' };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.ok !== 'boolean' || typeof r.run_id !== 'string' || typeof r.exit_code !== 'number') {
    return { valid: false, value: null, reason: 'result sentinel missing/mistyped ok|run_id|exit_code' };
  }
  return { valid: true, value: { ok: r.ok, run_id: r.run_id, exit_code: r.exit_code }, reason: null };
}

/**
 * Build the agent_runs.outputs jsonb payload — the validated result (or the
 * validation failure) plus a bounded tail of the structured logs, so a finished
 * run carries its outcome and a diagnosable trace rather than just an exit code.
 */
export function buildRunOutputs(
  v: ValidatedResult,
  logs: Array<{ level: string; message: string; meta?: Record<string, unknown> }>,
  maxLogs = 50,
): Record<string, unknown> {
  return {
    result: v.value,
    result_valid: v.valid,
    ...(v.reason ? { result_error: v.reason } : {}),
    logs: logs.slice(-maxLogs),
  };
}
