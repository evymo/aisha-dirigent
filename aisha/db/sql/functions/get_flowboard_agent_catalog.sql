-- ============================================================================
-- Source of Truth: get_flowboard_agent_catalog
-- Popis: Registry feed — active agents projected for the federated flowboard
--        palette. Non-sensitive catalog projection (slug/purpose/model/tools/
--        safety/autonomy of ACTIVE agents only); granted to authenticated for
--        the builder UI. No row-level data, only the agent catalog surface.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_flowboard_agent_catalog()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- The builder palette is owner-scoped UI: require an authenticated caller. The
  -- projection is non-sensitive, but a SECURITY DEFINER function must still verify
  -- the caller rather than rely on EXECUTE grants alone (no anonymous palette).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'slug', ac.slug, 'purpose', ac.purpose, 'default_model', ac.default_model,
             'allowed_tools', ac.allowed_tools, 'safety_level', ac.safety_level,
             'autonomy_level', ac.autonomy_level) ORDER BY ac.slug), '[]'::jsonb)
      FROM public.agent_catalog ac WHERE ac.is_active
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_flowboard_agent_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_flowboard_agent_catalog() TO authenticated, service_role;
