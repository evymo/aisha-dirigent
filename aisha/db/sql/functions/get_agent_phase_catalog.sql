-- ============================================================================
-- Source of Truth: get_agent_phase_catalog
-- Description: Returns the active agent phase taxonomy (all axes) for UI
--   consumers — Mission Control badges and the Dirigent VS Code panel read
--   labels from here instead of hardcoding phase→label maps. Static fallback
--   maps in clients cover offline/cold-start.
-- Security: SECURITY DEFINER, read-only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_agent_phase_catalog()
RETURNS TABLE (
  slug       text,
  axis       text,
  labels     jsonb,
  sort_order int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Auth: authenticated users and service_role; catalog labels are not
  -- sensitive but follow the platform default-deny posture for RPCs.
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.slug, c.axis, c.labels, c.sort_order
  FROM public.agent_phase_catalog c
  WHERE c.is_active = true
  ORDER BY c.axis, c.sort_order, c.slug;
END;
$$;

REVOKE ALL ON FUNCTION public.get_agent_phase_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_phase_catalog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_phase_catalog() TO service_role;

COMMENT ON FUNCTION public.get_agent_phase_catalog() IS
  'Active agent phase taxonomy (axis + slug + locale labels) for UI badge rendering. Clients keep a static fallback map for cold-start.';
