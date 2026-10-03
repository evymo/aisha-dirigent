-- Function: public.story_branch_deploy_rail
-- Description: Compact "rail" snapshot for the BranchDeployRail UI strip —
--   shows the story's current default_branch + most recent B/G slot state
--   per app + last rollback per app. Returns one row per associated app.
--
--   This is a flatter, smaller payload than story_timeline; the rail UI
--   uses it to render the vertical "branch → switches → rollbacks" axis
--   without having to filter the full timeline.
-- Security: SECURITY DEFINER, same admin-or-participant guard as
--   story_timeline.

CREATE OR REPLACE FUNCTION public.story_branch_deploy_rail(
  p_story_id uuid
)
RETURNS TABLE (
  app_name              text,
  active_slot           text,
  active_image_tag      text,
  inactive_image_tag    text,
  active_health         text,
  last_switch_at        timestamptz,
  default_branch        text,
  last_rollback_at      timestamptz,
  last_rollback_status  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_is_admin boolean := false;
  v_branch   text;
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

  SELECT ps.default_branch INTO v_branch
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;

  RETURN QUERY
  WITH last_rb AS (
    SELECT DISTINCT ON (rh.app_name)
      rh.app_name,
      rh.triggered_at,
      COALESCE(rh.execution_status, rh.approval_status) AS rb_status
    FROM public.rollback_history rh
    WHERE rh.app_name IN (
      SELECT cs.app_name FROM public.coolify_app_slots cs WHERE cs.story_id = p_story_id
    )
    ORDER BY rh.app_name, rh.triggered_at DESC
  )
  SELECT
    cs.app_name,
    cs.active_slot,
    CASE WHEN cs.active_slot = 'blue' THEN cs.blue_image_tag ELSE cs.green_image_tag END
      AS active_image_tag,
    CASE WHEN cs.active_slot = 'blue' THEN cs.green_image_tag ELSE cs.blue_image_tag END
      AS inactive_image_tag,
    CASE WHEN cs.active_slot = 'blue' THEN cs.blue_health ELSE cs.green_health END
      AS active_health,
    cs.last_switch_at,
    v_branch                  AS default_branch,
    lr.triggered_at            AS last_rollback_at,
    lr.rb_status               AS last_rollback_status
  FROM public.coolify_app_slots cs
  LEFT JOIN last_rb lr ON lr.app_name = cs.app_name
  WHERE cs.story_id = p_story_id
  ORDER BY cs.app_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.story_branch_deploy_rail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.story_branch_deploy_rail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.story_branch_deploy_rail(uuid) TO service_role;
