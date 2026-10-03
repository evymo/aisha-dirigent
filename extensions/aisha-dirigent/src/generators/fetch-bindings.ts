/**
 * Optional live-RPC fetch for claude_hook_bindings.
 *
 * When the extension has a valid AISHA gateway URL + auth token, prefer the
 * live `mcp_get_claude_hook_bindings` RPC over the bundled offline JSON
 * mirror. Failure (network down, no token, RPC error) → return `null` so the
 * caller falls back to the bundled mirror; the supervision overlay must
 * remain functional in cold-start / offline / unauthenticated modes.
 *
 * Per [feedback_coolify_api_unified_retry] this helper does NOT retry —
 * the bundled JSON mirror is a deterministic fallback, retry would just
 * delay falling back to it.
 *
 * @module
 */

import { callRpc } from "../backend-rpc";

// ---------------------------------------------------------------------------
// Canonical binding contract — the SINGLE TypeScript mirror of a
// `claude_hook_bindings` row. `adapter-claude-overlay.ts` imports these
// `type`-only from here so the two consumers can never drift apart: they
// previously held independent copies, and when `scanner_kind` grew the
// `relay`/`snapshot` values + the `config` column only the adapter copy was
// updated — the parser below then rejected every relay binding and collapsed
// the whole offline mirror to `[]`. One definition makes that unrepresentable.
// ---------------------------------------------------------------------------

/**
 * Allowed `scanner_kind` values — mirror of the table CHECK constraint
 * (`claude_hook_bindings_scanner_kind_check`). The single enum SoT: the parser
 * validates membership against it and {@link ScannerKind} derives from it, so
 * adding a kind is a one-line change here that every consumer picks up.
 *
 * - `regex` / `heuristic` — pattern matchers (advisory hook scripts).
 * - `relay` / `snapshot` — config-driven push scanners (the supervisor relay
 *   and workflow snapshot): no `pattern_regex`, they carry `config`.
 */
export const SCANNER_KINDS = ["regex", "heuristic", "relay", "snapshot"] as const;
export type ScannerKind = (typeof SCANNER_KINDS)[number];

/**
 * Locale-aware messages for a binding. Required keys `cs` + `en`; additional
 * locales may be present (CHECK constraint enforces at least cs+en on the
 * backend table).
 */
export interface BindingMessages {
  cs: string;
  en: string;
  [locale: string]: string;
}

/** One hook-event wiring inside a relay/snapshot binding's `config.events`. */
export interface RelayEventConfig {
  arg: string;
  hook_event: string;
  matcher?: string;
}

/**
 * `config` jsonb payload for config-driven scanners (`relay` / `snapshot`).
 * Interpreted by the generated supervisor-relay script — see
 * `scripts/ide-adapters/templates/claude-overlay/aisha-supervisor-relay.mjs.txt`.
 */
export interface RelayConfig {
  source?: string;
  endpoint_path?: string;
  timeout_ms?: number;
  events?: RelayEventConfig[];
  phase_map?: Record<string, unknown>;
  tool_derivation?: Array<{ tool: string; all_of: string[] }>;
}

/** Mirror of `mcp_get_claude_hook_bindings` RPC / seed row shape. */
export interface ClaudeHookBinding {
  rule_slug: string;
  hook_event: string;
  matcher: string;
  scanner_kind: ScannerKind;
  /** Required for `regex`; `null`/absent for `heuristic` and config-driven kinds. */
  pattern_regex?: string | null;
  messages: BindingMessages;
  hint?: string | null;
  cooldown_sec: number;
  severity: "low" | "moderate" | "high";
  /** Required for `relay`/`snapshot`; `null`/absent for pattern matchers. */
  config?: RelayConfig | null;
}

/**
 * Fetch the active rule bindings from the AISHA backend.
 *
 * @param storyId - reserved for future story-scoped bindings; pass `null`
 *                  for the default global set
 * @returns array of bindings on success, `null` on any failure
 */
export async function fetchClaudeHookBindings(
  storyId: string | null = null,
): Promise<ClaudeHookBinding[] | null> {
  const { data } = await callRpc<unknown>("mcp_get_claude_hook_bindings", {
    p_story_id: storyId,
  });
  return parseBindings(data);
}

/**
 * Defensive parser — the RPC returns `jsonb` so the shape isn't enforced by
 * the wire format. Validate every field; reject the entire payload on any
 * mismatch (better to fall back to the bundled mirror than to render garbage
 * hooks). Exported for testability.
 *
 * `scanner_kind` is validated against {@link SCANNER_KINDS} (the single enum
 * SoT) — any value the table CHECK allows, the parser accepts. The two scanner
 * families have mutually-exclusive payloads, both enforced here:
 *   - pattern matchers (`regex`) require `pattern_regex`;
 *   - config-driven scanners (`relay` / `snapshot`) carry no `pattern_regex`
 *     and require a `config` object (the relay/snapshot has nothing to do
 *     without it — see `adapter-claude-overlay.ts::pickRelayBinding`).
 */
export function parseBindings(raw: unknown): ClaudeHookBinding[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ClaudeHookBinding[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const i = item as Record<string, unknown>;
    const messagesRaw = i.messages;
    const messagesValid =
      typeof messagesRaw === "object" &&
      messagesRaw !== null &&
      !Array.isArray(messagesRaw) &&
      typeof (messagesRaw as Record<string, unknown>).cs === "string" &&
      typeof (messagesRaw as Record<string, unknown>).en === "string";
    const kindValid = (SCANNER_KINDS as readonly string[]).includes(
      i.scanner_kind as string,
    );
    if (
      typeof i.rule_slug !== "string" ||
      typeof i.hook_event !== "string" ||
      typeof i.matcher !== "string" ||
      !kindValid ||
      !messagesValid ||
      typeof i.cooldown_sec !== "number" ||
      (i.severity !== "low" && i.severity !== "moderate" && i.severity !== "high")
    ) {
      return null;
    }
    const kind = i.scanner_kind as ScannerKind;
    // Pattern matchers need a pattern; config-driven scanners need a config.
    if (kind === "regex" && typeof i.pattern_regex !== "string") {
      return null;
    }
    const configValid =
      typeof i.config === "object" && i.config !== null && !Array.isArray(i.config);
    if ((kind === "relay" || kind === "snapshot") && !configValid) {
      return null;
    }
    out.push({
      rule_slug: i.rule_slug,
      hook_event: i.hook_event,
      matcher: i.matcher,
      scanner_kind: kind,
      pattern_regex: typeof i.pattern_regex === "string" ? i.pattern_regex : null,
      messages: messagesRaw as BindingMessages,
      hint: typeof i.hint === "string" ? i.hint : null,
      cooldown_sec: i.cooldown_sec,
      severity: i.severity,
      config: configValid ? (i.config as RelayConfig) : null,
    });
  }
  return out;
}
