-- Function: derive_clow_needs
-- Derives a clow's CAPABILITY NEEDS (needs_write / needs_internet / needs_tools +
-- an optional runtime hint) from the task's semantics, so the runtime resolver
-- (fn_resolve_runtime) and the graph chooser (aisha_choose_execution_strategy) can
-- pick an executor that MATCHES the work — instead of every task defaulting to
-- direct_llm because nothing ever set the needs (the audit's static-link gap).
--
-- This is the SINGLE producer of clow needs, reused by both the chooser (to route a
-- capability-needing task to the runtime-execute graph) and openclaw_resolve_clow
-- (to populate the clow before fn_resolve_runtime). Precedence:
--   1. EXPLICIT task.needs_* / task.runtime ALWAYS win (a producer that knows the
--      task's requirements declares them precisely — this is NOT a gate).
--   2. Otherwise a SEMANTIC intent derivation from type + risk_level + a keyword
--      scan of the description, reusing the same keyword style the chooser already
--      uses for slot classification (write→ember, web→webSearch). It is intent
--      detection, NOT a roster of permitted names.
--
-- hermes (the reflexive-learning rail) is hinted only for a story-bound self-eval /
-- story-closure task — it executes evaluate_story_self(story_id), which needs both.

CREATE OR REPLACE FUNCTION public.derive_clow_needs(p_task jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_desc  text    := COALESCE(p_task->>'description', '') || ' ' || COALESCE(p_task->>'purpose', '');
  v_type  text    := lower(COALESCE(p_task->>'type', p_task->>'task_kind', ''));
  v_risk  text    := COALESCE(p_task->>'risk_level', 'low');
  v_story uuid    := NULLIF(p_task->>'story_id', '')::uuid;
  v_write boolean;
  v_net   boolean;
  v_tools boolean;
  v_hint  text;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- needs_write — side-effecting / mutating work
  v_write := COALESCE((p_task->>'needs_write')::boolean,
      v_type IN ('deploy', 'execute', 'code', 'agentic')
      OR v_desc ~* '\y(deploy|write|edit|create|implement|fix|refactor|build|migrat|rollout|delete|provision|install|publish)\y');

  -- needs_internet — outbound network / web access
  v_net := COALESCE((p_task->>'needs_internet')::boolean,
      v_desc ~* '\y(search|google|lookup|web|fetch|crawl|scrape|download|browse|http|api call)\y');

  -- needs_tools — tool-use / sandbox / multi-step agentic execution
  v_tools := COALESCE((p_task->>'needs_tools')::boolean,
      v_risk = 'high'
      OR v_type IN ('agentic', 'deploy', 'execute')
      OR v_desc ~* '\y(tool|agent|sandbox|orchestrat|multi.?step|run command|pipeline)\y');

  -- runtime hint — hermes is the learning rail (needs a story to evaluate)
  v_hint := CASE
    WHEN COALESCE(p_task->>'runtime', '') <> '' THEN p_task->>'runtime'   -- explicit override
    -- hermes only for genuine story-CLOSURE/eval tasks. NOT 'reflection'/'story_plan'
    -- — those route to the story-plan-reflect graph (which doesn't runtime-dispatch),
    -- so a hermes hint there would be derived-but-never-used (a dead signal).
    WHEN v_story IS NOT NULL AND v_type IN ('self_eval', 'story_closure', 'evaluate', 'learn')
      THEN 'hermes'
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'needs_write', v_write,
    'needs_internet', v_net,
    'needs_tools', v_tools,
    'runtime', v_hint,
    'has_capability_need', (v_write OR v_net OR v_tools OR v_hint IS NOT NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.derive_clow_needs(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.derive_clow_needs(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.derive_clow_needs(jsonb) TO service_role;

COMMENT ON FUNCTION public.derive_clow_needs(jsonb) IS
  'Single producer of clow capability needs (needs_write/internet/tools + runtime hint) from task semantics; explicit task.needs_*/runtime win. Reused by aisha_choose_execution_strategy (routing) + openclaw_resolve_clow (clow population) so runtime selection is fed dynamically, not hardcoded direct_llm.';
