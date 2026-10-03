-- Table: claude_hook_bindings
-- Source: hand-authored; deploy via migration 20260524000000_claude_hook_bindings.sql
-- Purpose: Source-of-truth for AISHA Dirigent advisory rules that the IDE adapter
--          pipeline (scripts/ide-adapters/adapter-claude-overlay.mjs and its TS
--          port in extensions/aisha-dirigent/src/generators/) compiles into
--          .claude/hooks/aisha-advise-*.sh shell scripts on `npm run gen:ide`.
--          Until 2026-05-23 these 5 regex rules lived only in
--          extensions/aisha-dirigent/src/copilot-watcher.ts:47 (hardcoded TS array),
--          causing drift between VS Code extension and Claude Code hooks. This
--          table is the canonical SoT both surfaces read from.
--
-- MVP scope: 5 regex-pattern rules (rpc-only, no-console, no-any, ts-ignore,
--            select-star). The 2 multi-pattern heuristic hooks (i18n,
--            bash-risk) remain as static generator templates; future iteration
--            adds `scanner_kind = 'heuristic'` to host them too.

-- Locale-aware messages stored as JSONB ({cs, en, …}) — extensible to more
-- locales without schema change, and matches AISHA's `<name>_key` +
-- translations pattern for free-form policy text. Bash hook scripts read
-- the embedded JSON mirror (aisha/db/seed/claude_hook_bindings.json)
-- offline, so DB rows don't need to JOIN translations at hook-fire time.
CREATE TABLE IF NOT EXISTS public.claude_hook_bindings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  rule_slug text NOT NULL,
  hook_event text NOT NULL,
  matcher text NOT NULL,
  scanner_kind text NOT NULL DEFAULT 'regex',
  pattern_regex text,
  messages jsonb NOT NULL,
  hint text,
  cooldown_sec integer NOT NULL DEFAULT 45,
  severity text NOT NULL,
  -- Structured per-binding configuration for non-regex kinds:
  --   relay:    {events: [{arg, hook_event, matcher?}], phase_map,
  --              tool_derivation, source, endpoint_path, timeout_ms}
  --   snapshot: {events, rate_limit_sec, timeout_ms}
  -- The generator injects this JSON verbatim into the script template
  -- ({{RELAY_CONFIG_JSON}}), so behaviour changes are seed-data changes.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT claude_hook_bindings_rule_slug_unique UNIQUE (rule_slug),
  CONSTRAINT claude_hook_bindings_severity_check CHECK (severity IN ('low','moderate','high')),
  CONSTRAINT claude_hook_bindings_scanner_kind_check CHECK (scanner_kind IN ('regex','heuristic','relay','snapshot')),
  CONSTRAINT claude_hook_bindings_hook_event_check CHECK (hook_event IN ('PreToolUse','PostToolUse','SessionStart','Stop')),
  CONSTRAINT claude_hook_bindings_cooldown_positive CHECK (cooldown_sec >= 0),
  CONSTRAINT claude_hook_bindings_regex_when_kind_regex
    CHECK (scanner_kind <> 'regex' OR pattern_regex IS NOT NULL),
  CONSTRAINT claude_hook_bindings_messages_has_locales
    CHECK (messages ? 'cs' AND messages ? 'en')
);

-- Index moved to aisha/db/sql/indexes/claude_hook_bindings_active_idx.sql
-- per AISHA source-of-truth separation (tables/ vs indexes/).

ALTER TABLE public.claude_hook_bindings ENABLE ROW LEVEL SECURITY;

-- Heal: `config` was added by fe939cf1 (agent-activity) to BOTH this table and
-- the seed. CREATE TABLE IF NOT EXISTS above does NOT add the column to a
-- pre-existing table (created before fe939cf1), so the seed's
-- INSERT (..., config) errors "column config does not exist" on upgraded DBs →
-- db:seed fails → migrate exit 1 (observed 2026-06-15 prod redeploy). Idempotent
-- ADD COLUMN IF NOT EXISTS heals them; no-op on fresh DBs. (story_labels.sql
-- convention; DEFAULT '{}' backfills existing rows under NOT NULL safely.)
ALTER TABLE public.claude_hook_bindings ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
