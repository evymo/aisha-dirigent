/**
 * Canned responses for /rpc/mcp_get_claude_hook_bindings.
 *
 * Shapes derive from `aisha/db/seed/claude_hook_bindings.json` (the SoT
 * mirror). Keep this file aligned with that SoT — the remediation gate
 * src/tests/gates/remediation/e2e-bindings-fixture-contract.gate.test.ts
 * enforces per-rule alignment (pattern_regex / hook_event / cooldown_sec).
 */

export interface HookBinding {
  rule_slug: string;
  hook_event: "PreToolUse" | "PostToolUse" | "SessionStart" | "Stop";
  matcher: string;
  scanner_kind: "regex" | "heuristic";
  pattern_regex: string | null;
  messages: { cs: string; en: string; [locale: string]: string };
  hint: string | null;
  cooldown_sec: number;
  severity: "low" | "moderate" | "high";
}

export const DEFAULT_BINDINGS: HookBinding[] = [
  {
    rule_slug: "rpc-only",
    hook_event: "PreToolUse",
    matcher: "Edit|Write|MultiEdit",
    scanner_kind: "regex",
    pattern_regex: "\\.from\\(\\s*[\"'`][^\"'`]{1,60}[\"'`]\\s*\\)\\s*\\.\\s*(select|insert|update|delete|upsert)\\b",
    messages: {
      cs: "AISHA Architecture: použij rpcUser/rpcService místo přímého .from() — RPC-Only Pattern.",
      en: "AISHA Architecture: use rpcUser/rpcService instead of direct .from() — RPC-Only Pattern.",
    },
    hint: "@aisha jak vyřešit rpc-only?",
    cooldown_sec: 45,
    severity: "high",
  },
  {
    rule_slug: "no-console",
    hook_event: "PreToolUse",
    matcher: "Edit|Write|MultiEdit",
    scanner_kind: "regex",
    pattern_regex: "console\\.log\\s*\\(",
    messages: {
      cs: "AISHA Hygiena: nepoužívej console.log — použij safeError() / structured logger.",
      en: "AISHA Hygiene: don't use console.log — use safeError() / structured logger.",
    },
    hint: null,
    cooldown_sec: 45,
    severity: "moderate",
  },
  {
    rule_slug: "no-any",
    hook_event: "PreToolUse",
    matcher: "Edit|Write|MultiEdit",
    scanner_kind: "regex",
    pattern_regex: "(\\bas\\s+any\\b|:\\s*any\\b)",
    messages: {
      cs: "TypeScript: vyhni se any — použij konkrétní typ nebo unknown + type guard.",
      en: "TypeScript: avoid any — use a concrete type or unknown + type guard.",
    },
    hint: null,
    cooldown_sec: 45,
    severity: "moderate",
  },
  {
    rule_slug: "ts-ignore",
    hook_event: "PreToolUse",
    matcher: "Edit|Write|MultiEdit",
    scanner_kind: "regex",
    pattern_regex: "@ts-ignore\\b",
    messages: {
      cs: "TypeScript: nepoužívej @ts-ignore — použij @ts-expect-error s komentářem.",
      en: "TypeScript: don't use @ts-ignore — use @ts-expect-error with a comment.",
    },
    hint: null,
    cooldown_sec: 45,
    severity: "moderate",
  },
  {
    rule_slug: "select-star",
    hook_event: "PreToolUse",
    matcher: "Edit|Write|MultiEdit",
    scanner_kind: "regex",
    pattern_regex: "\\.select\\(\\s*[\"'`]\\s*\\*\\s*[\"'`]\\s*\\)",
    messages: {
      cs: "Architecture: nepiš .select('*') — vyjmenuj sloupce.",
      en: "Architecture: don't use .select('*') — list columns explicitly.",
    },
    hint: null,
    cooldown_sec: 45,
    severity: "moderate",
  },
];
