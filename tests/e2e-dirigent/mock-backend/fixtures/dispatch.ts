/**
 * Canned responses for POST /dirigent/dispatch.
 *
 * Shape derives from `services/svc-ai-chat/src/routes/dirigent-supervisor.ts`:
 *   { additionalContext: string, nudges?: Nudge[], decision?: "allow"|"block"|"ask" }
 *
 * Each fixture is keyed by event type; specs override per-test via
 * POST /__test__/configure-dispatch with a partial map.
 */

export interface DispatchResponse {
  additionalContext: string;
  nudges?: Array<{ id: string; message: string; severity: string }>;
  decision?: "allow" | "block" | "ask";
}

export const DEFAULT_DISPATCH: Record<string, DispatchResponse> = {
  // Empty by default — spec opts in to escalation by overriding this fixture.
  session_start: { additionalContext: "" },
  pre_tool: { additionalContext: "" },
  post_tool: { additionalContext: "" },
  prompt_submit: { additionalContext: "" },
  // goal_evaluator (the stop hook) is the only one allowed to return
  // decision != allow (block | ask); all others stay at allow.
  stop: { additionalContext: "", decision: "allow" },
};

/**
 * Convenience fixture: backend escalates with an advisory message
 * during session_start. Used by relay-escalation specs.
 */
export const ESCALATION_FIXTURE: Record<string, DispatchResponse> = {
  session_start: {
    additionalContext:
      "🛡️ AISHA Dirigent: detekuji žes začal pracovat na story s aktivními rule_bindings. Doporučuji: použij rpcService<T>() pattern pro všechny nové RPCs.",
    nudges: [
      {
        id: "test-nudge-1",
        message: "Připomenutí: RPC-Only Pattern je pro tuto story závazný.",
        severity: "high",
      },
    ],
  },
};
