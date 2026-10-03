-- Seed: claude_hook_bindings — 5 regex advisory rules + supervisor relay binding
-- Source-of-truth migrated from extensions/aisha-dirigent/src/copilot-watcher.ts:47
-- (hardcoded VIOLATION_RULES TS array, 2026-04 → 2026-05).
-- Moved 2026-06-12 from aisha/db/seed/claude_hook_bindings.sql into seed/core/
-- so cold-start databases actually receive the rows (the root-level file was
-- never applied by compile-seed — the table sat empty on fresh installs and
-- only the JSON mirror kept the generator working).
--
-- The 2 multi-pattern heuristic hooks (i18n, bash-risk) remain as static
-- generator templates emitted unconditionally; future iteration migrates them
-- to scanner_kind='heuristic' rows here.
--
-- JSON mirror: aisha/db/seed/claude_hook_bindings.json (offline generator
-- fallback) — keep in lockstep; claude-overlay-drift.gate enforces parity.

INSERT INTO public.claude_hook_bindings
  (rule_slug, hook_event, matcher, scanner_kind, pattern_regex,
   messages, hint, cooldown_sec, severity)
VALUES
  (
    'rpc-only',
    'PreToolUse',
    'Edit|Write|MultiEdit',
    'regex',
    '\.from\(\s*["''`][^"''`]{1,60}["''`]\s*\)\s*\.\s*(select|insert|update|delete|upsert)\b',
    jsonb_build_object(
      'cs', 'RPC-Only: Přímý .from() dotaz na tabulku — použij rpcUser()/rpcService() z services/svc-ai-chat/src/lib/rpcAdapter.ts.',
      'en', 'RPC-Only: direct .from() table query — use rpcUser()/rpcService() from services/svc-ai-chat/src/lib/rpcAdapter.ts.'
    ),
    '@aisha Jak nahradím .from().select() správným RPC vzorem?',
    45,
    'high'
  ),
  (
    'no-console',
    'PreToolUse',
    'Edit|Write|MultiEdit',
    'regex',
    'console\.log\s*\(',
    jsonb_build_object(
      'cs', 'Hygiena: console.log() není povoleno. Použij safeError() pro error logování.',
      'en', 'Hygiene: console.log() is not permitted. Use safeError() for error logging.'
    ),
    '@aisha Jak správně logovat chyby?',
    45,
    'moderate'
  ),
  (
    'no-any',
    'PreToolUse',
    'Edit|Write|MultiEdit',
    'regex',
    '(\bas\s+any\b|:\s*any\b)',
    jsonb_build_object(
      'cs', 'Hygiena: Typ ''any'' není povolen. Použij proper typy nebo unknown + type guard.',
      'en', 'Hygiene: Type ''any'' is not permitted. Use proper types or unknown + type guard.'
    ),
    '@aisha Jak nahradím ''any'' typ správným type guardem?',
    45,
    'moderate'
  ),
  (
    'ts-ignore',
    'PreToolUse',
    'Edit|Write|MultiEdit',
    'regex',
    '@ts-ignore\b',
    jsonb_build_object(
      'cs', 'Hygiena: @ts-ignore není povolen. Použij @ts-expect-error s vysvětlujícím komentářem.',
      'en', 'Hygiene: @ts-ignore is not permitted. Use @ts-expect-error with explanatory comment.'
    ),
    '@aisha Jak správně použít @ts-expect-error?',
    45,
    'moderate'
  ),
  (
    'select-star',
    'PreToolUse',
    'Edit|Write|MultiEdit',
    'regex',
    '\.select\(\s*["''`]\s*\*\s*["''`]\s*\)',
    jsonb_build_object(
      'cs', 'RPC-Only: .select("*") — vždy vyjmenuj explicitní sloupce, nikoli wildcard.',
      'en', 'RPC-Only: .select("*") — always list explicit columns, never wildcard.'
    ),
    '@aisha Které sloupce mám vybrat místo *?',
    45,
    'moderate'
  )
ON CONFLICT (rule_slug) DO UPDATE SET
  hook_event = EXCLUDED.hook_event,
  matcher = EXCLUDED.matcher,
  scanner_kind = EXCLUDED.scanner_kind,
  pattern_regex = EXCLUDED.pattern_regex,
  messages = EXCLUDED.messages,
  hint = EXCLUDED.hint,
  cooldown_sec = EXCLUDED.cooldown_sec,
  severity = EXCLUDED.severity,
  is_active = true,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- supervisor-relay — scanner_kind='relay': the Vrstva 2 HTTP relay binding.
-- One row = one generated script (.claude/hooks/aisha-supervisor-relay.mjs).
-- config.events drives the settings.json wiring (which hook events + matchers
-- invoke the script); phase_map + tool_derivation are interpreted by the
-- generated script at hook-fire time — behaviour changes are data changes
-- here, regenerated via `npm run gen:ide -- --format=claude-overlay`.
-- hook_event/matcher columns hold the PRIMARY event (settings wiring reads
-- config.events; these columns satisfy the NOT NULL schema contract).
-- ---------------------------------------------------------------------------
INSERT INTO public.claude_hook_bindings
  (rule_slug, hook_event, matcher, scanner_kind, pattern_regex,
   messages, hint, cooldown_sec, severity, config)
VALUES
  (
    'supervisor-relay',
    'SessionStart',
    '*',
    'relay',
    NULL,
    jsonb_build_object(
      'cs', 'Supervisor relay: odesílá hook události (session_start/pre_tool/post_tool/stop) na /dirigent/dispatch pro živý monitoring a advisory nudges.',
      'en', 'Supervisor relay: forwards hook events (session_start/pre_tool/post_tool/stop) to /dirigent/dispatch for live monitoring and advisory nudges.'
    ),
    NULL,
    0,
    'low',
    $json$
    {
      "source": "claude-code",
      "endpoint_path": "/dirigent/dispatch",
      "timeout_ms": 5000,
      "events": [
        { "arg": "session_start", "hook_event": "SessionStart" },
        { "arg": "pre_tool", "hook_event": "PreToolUse", "matcher": "Edit|Write|MultiEdit|Agent" },
        { "arg": "post_tool", "hook_event": "PostToolUse", "matcher": "Edit|Write|MultiEdit|Bash|Agent" },
        { "arg": "stop", "hook_event": "Stop" }
      ],
      "phase_map": {
        "session_start": "session_start",
        "stop": "stopped",
        "pre_tool": { "Agent": "planning", "default": "tool_use" },
        "post_tool": { "default": "reviewing" },
        "default": "idle"
      },
      "tool_derivation": [
        { "tool": "Agent", "all_of": ["description", "prompt"] },
        { "tool": "MultiEdit", "all_of": ["edits"] },
        { "tool": "Bash", "all_of": ["command"] },
        { "tool": "Edit", "all_of": ["file_path", "new_string"] },
        { "tool": "Write", "all_of": ["file_path", "content"] }
      ]
    }
    $json$::jsonb
  )
ON CONFLICT (rule_slug) DO UPDATE SET
  hook_event = EXCLUDED.hook_event,
  matcher = EXCLUDED.matcher,
  scanner_kind = EXCLUDED.scanner_kind,
  pattern_regex = EXCLUDED.pattern_regex,
  messages = EXCLUDED.messages,
  hint = EXCLUDED.hint,
  cooldown_sec = EXCLUDED.cooldown_sec,
  severity = EXCLUDED.severity,
  config = EXCLUDED.config,
  is_active = true,
  updated_at = now();
