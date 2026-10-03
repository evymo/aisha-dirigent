-- Index: claude_hook_bindings_active_idx
-- Source: hand-authored; deploy via migration 20260524000000_claude_hook_bindings.sql
-- Purpose: Partial index covering only active rule bindings. The generator
--          (scripts/ide-adapters/adapter-claude-overlay.mjs + extension TS port)
--          and live-RPC fetch (mcp_get_claude_hook_bindings) both filter
--          `WHERE is_active = true`. Partial index keeps the working set
--          small as soon as deprecated rules accumulate in the table.

CREATE INDEX IF NOT EXISTS claude_hook_bindings_active_idx
  ON public.claude_hook_bindings (is_active)
  WHERE is_active = true;
