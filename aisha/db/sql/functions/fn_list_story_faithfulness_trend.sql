-- ============================================================================
-- Source of Truth: fn_list_story_faithfulness_trend
-- Phase 12 WP 1.5 — Faithfulness UI panel
-- Used by: src/hooks/useStoryFaithfulnessTrend.ts → StoryFaithfulnessSparkline.tsx
-- ============================================================================
--
-- Returns the most recent N faithfulness scores for a given story by joining
-- ai_runs (where faithfulness_score_estimate is populated by the critic loop
-- + RAG eval pipeline) and ordering by started_at DESC.
--
-- Visibility: re-enforces P7 RLS contract via is_admin_or_staff() OR
-- is_story_participant() — same pattern as get_workspace_context (WP 13.1).
--
-- NO PII in output — only score, timestamp, agent_slug. Body/prompt content
-- stays in Langfuse traces; this is a cardinal-low trend view for the
-- Overview tab sparkline.

CREATE OR REPLACE FUNCTION public.fn_list_story_faithfulness_trend(
  p_story_id uuid,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  run_id        uuid,
  faithfulness  numeric,
  agent_slug    text,
  kind          text,
  started_at    timestamptz,
  finished_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_limit int := LEAST(GREATEST(p_limit, 1), 200);  -- cap at 200 for safety
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated' USING ERRCODE = '22023';
  END IF;

  IF p_story_id IS NULL THEN
    RAISE EXCEPTION 'p_story_id is required' USING ERRCODE = '22023';
  END IF;

  -- Visibility check: admin/staff sees all, participants see own stories,
  -- stack-default story is visible to all authenticated users.
  IF NOT public.is_admin_or_staff(v_user_id)
     AND NOT public.is_story_participant(v_user_id, p_story_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_stories
       WHERE id = p_story_id AND is_stack_default = true
     ) THEN
    RAISE EXCEPTION 'Forbidden: not a participant of story %', p_story_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ar.id,
    ar.faithfulness_score_estimate,
    (ar.metadata->>'current_agent_slug')::text AS agent_slug,
    ar.kind,
    ar.started_at,
    ar.finished_at
  FROM public.ai_runs ar
  WHERE ar.story_id = p_story_id
    AND ar.faithfulness_score_estimate IS NOT NULL
  ORDER BY ar.started_at DESC
  LIMIT v_limit;
END;
$$;

-- Permissions per CLAUDE.md SECURITY DEFINER pattern
REVOKE ALL ON FUNCTION public.fn_list_story_faithfulness_trend(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_list_story_faithfulness_trend(uuid, int) TO authenticated;
