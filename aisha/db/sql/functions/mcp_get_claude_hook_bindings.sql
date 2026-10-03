-- Function: public.mcp_get_claude_hook_bindings
-- Arguments: p_story_id uuid (reserved for future story-scoped filtering; MVP ignores)
-- Security: SECURITY DEFINER (read-only — returns public coding policy)
-- Source: hand-authored; deploy via migration 20260524000000_claude_hook_bindings.sql
--
-- Purpose: SoT for AISHA Dirigent Claude Code overlay generator. Returns the
--          active advisory rule set as jsonb array, consumed by
--          scripts/ide-adapters/adapter-claude-overlay.mjs (CLI) and its TS port
--          in extensions/aisha-dirigent/src/generators/ to emit
--          .claude/hooks/aisha-advise-*.sh shell scripts. Pure read; no audit
--          (the generator runs offline as a build step).

CREATE OR REPLACE FUNCTION public.mcp_get_claude_hook_bindings(
  p_story_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bindings jsonb;
BEGIN
  -- MVP: p_story_id reserved for future per-story rule sets (e.g. fintech story
  -- enables PCI-specific hooks). Today returns all active.
  SELECT jsonb_agg(
    jsonb_build_object(
      'rule_slug', rule_slug,
      'hook_event', hook_event,
      'matcher', matcher,
      'scanner_kind', scanner_kind,
      'pattern_regex', pattern_regex,
      'messages', messages,
      'hint', hint,
      'cooldown_sec', cooldown_sec,
      'severity', severity,
      'config', config
    )
    ORDER BY rule_slug
  )
  INTO v_bindings
  FROM public.claude_hook_bindings
  WHERE is_active = true;

  RETURN COALESCE(v_bindings, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_get_claude_hook_bindings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_get_claude_hook_bindings(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.mcp_get_claude_hook_bindings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_claude_hook_bindings(uuid) TO service_role;
