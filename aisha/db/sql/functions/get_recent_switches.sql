-- ============================================================================
-- Source of Truth: get_recent_switches
-- Popis: Returns apps switched in last X minutes. Used by WF_SENTRY_OBSERVER pro
--        deploy correlation. is_production flag detekován z domain pattern nebo
--        explicit metadata.is_production override.
-- Volá: WF_SENTRY_OBSERVER (Phase 3) — koreluje Sentry issues s recent switches
-- Auth: admin/staff nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_recent_switches(
  p_window_minutes int DEFAULT 30
)
RETURNS TABLE (
  app_name        text,
  active_slot     text,
  active_image_tag text,
  switched_at     timestamptz,
  is_production   boolean
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
    cas.last_switch_at AS switched_at,
    -- AISHA prod = domain matches main aisha.guru patterns
    -- Pro user stories: production je fixed convention v config
    COALESCE(
      (cas.metadata->>'is_production')::boolean,
      cas.domain ~ '^(aisha\.guru|app\.aisha\.guru|api\.aisha\.guru)$'
    ) AS is_production
  FROM public.coolify_app_slots cas
  WHERE cas.last_switch_at IS NOT NULL
    AND cas.last_switch_at > now() - (p_window_minutes || ' minutes')::interval
  ORDER BY cas.last_switch_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_recent_switches(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_switches(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_switches(int) TO service_role;
