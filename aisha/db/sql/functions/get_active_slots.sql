-- ============================================================================
-- Source of Truth: get_active_slots
-- Popis: Read-only view pro Phase 4 dashboard — vrací current B/G state s
--        active/inactive slot, image tags, healths, switch lock state.
--        Včetně managed_kind: 'system' (NULL story_id) | 'user_story'.
-- Volá: WF_APPSMITH_DASHBOARD_BUILDER, dashboard widgets
-- Auth: admin/staff (read-only) nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_active_slots()
RETURNS TABLE (
  app_name             text,
  active_slot          text,
  active_image_tag     text,
  active_health        text,
  inactive_slot        text,
  inactive_image_tag   text,
  inactive_health      text,
  last_switch_at       timestamptz,
  last_switch_by       uuid,
  switch_lock          boolean,
  switch_lock_age_min  int,
  domain               text,
  story_id             uuid,
  managed_kind         text     -- 'system' (NULL story_id) | 'user_story'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF NOT public.is_admin_or_staff()
     AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    cas.app_name,
    cas.active_slot,
    CASE cas.active_slot
      WHEN 'blue' THEN cas.blue_image_tag
      ELSE cas.green_image_tag
    END AS active_image_tag,
    CASE cas.active_slot
      WHEN 'blue' THEN cas.blue_health
      ELSE cas.green_health
    END AS active_health,
    CASE cas.active_slot WHEN 'blue' THEN 'green' ELSE 'blue' END AS inactive_slot,
    CASE cas.active_slot
      WHEN 'blue' THEN cas.green_image_tag
      ELSE cas.blue_image_tag
    END AS inactive_image_tag,
    CASE cas.active_slot
      WHEN 'blue' THEN cas.green_health
      ELSE cas.blue_health
    END AS inactive_health,
    cas.last_switch_at,
    cas.last_switch_by,
    cas.switch_lock,
    CASE
      WHEN cas.switch_lock_at IS NULL THEN NULL
      ELSE EXTRACT(EPOCH FROM (now() - cas.switch_lock_at))::int / 60
    END AS switch_lock_age_min,
    cas.domain,
    cas.story_id,
    CASE WHEN cas.story_id IS NULL THEN 'system' ELSE 'user_story' END AS managed_kind
  FROM public.coolify_app_slots cas
  ORDER BY cas.app_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_slots() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_slots() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_slots() TO service_role;
