-- Function: public.list_hippocampus_signals
-- Description: Returns agent_memories rows captured by the hippocampus
--   layer for a given story (agent_slug LIKE 'hippocampus:%'), with
--   server-side PII-safe `content_preview` (LEFT 200 chars + email/phone
--   scrub). Full content requires reveal_hippocampus_content_audited.
-- Security: SECURITY DEFINER, admin-or-participant gate. Memories are
--   joined to story via source_run_id → ai_runs.story_id.
-- See also: reveal_hippocampus_content_audited (per-row reveal w/ audit),
--   set_memory_governance_audited (promote/forget/suspend).

CREATE OR REPLACE FUNCTION public.list_hippocampus_signals(
  p_story_id uuid,
  p_agent_slug text DEFAULT NULL
)
RETURNS TABLE (
  memory_id        uuid,
  agent_slug       text,
  memory_type      text,
  importance       int,
  content_preview  text,
  preview_truncated boolean,
  expires_at       timestamptz,
  source_run_id    uuid,
  created_at       timestamptz,
  updated_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);

  IF NOT v_is_admin
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_stories ps
       WHERE ps.id = p_story_id
         AND (
           ps.is_stack_default = true
           OR EXISTS (
             SELECT 1 FROM public.story_participants sp
             WHERE sp.story_id = ps.id AND sp.user_id = v_user_id
           )
         )
     )
  THEN
    RAISE EXCEPTION 'Access denied: story participant or admin/staff required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH scrubbed AS (
    SELECT
      am.id, am.agent_slug, am.memory_type, am.importance,
      am.content, am.expires_at, am.source_run_id,
      am.created_at, am.updated_at,
      LENGTH(am.content) > 200 AS truncated,
      -- PII scrub: email + phone-like patterns are masked. Conservative
      -- regex set; reveal RPC bypasses the scrub for full audit-logged
      -- reveal.
      regexp_replace(
        regexp_replace(
          LEFT(am.content, 200),
          '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
          '[email]',
          'g'
        ),
        '\+?\d[\d\s().-]{7,}\d',
        '[phone]',
        'g'
      ) AS preview
    FROM public.agent_memories am
    WHERE am.agent_slug LIKE 'hippocampus:%'
      AND (p_agent_slug IS NULL OR am.agent_slug = p_agent_slug)
      AND am.source_run_id IN (
        SELECT id FROM public.ai_runs WHERE story_id = p_story_id
      )
      AND (am.expires_at IS NULL OR am.expires_at > now())
  )
  SELECT
    sc.id          AS memory_id,
    sc.agent_slug,
    sc.memory_type,
    sc.importance,
    sc.preview     AS content_preview,
    sc.truncated   AS preview_truncated,
    sc.expires_at,
    sc.source_run_id,
    sc.created_at,
    sc.updated_at
  FROM scrubbed sc
  ORDER BY sc.importance DESC, sc.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_hippocampus_signals(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_hippocampus_signals(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_hippocampus_signals(uuid, text) TO service_role;
