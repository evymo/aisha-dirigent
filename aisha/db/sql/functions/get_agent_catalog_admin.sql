-- Function: public.get_agent_catalog_admin
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_agent_catalog_admin()
 RETURNS TABLE(id uuid, slug text, display_name text, purpose text, default_model text, default_context_profile text, safety_level text, max_loops integer, allowed_tools text[], denied_tools text[], model_overrides jsonb, autonomy_level text, is_active boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    ac.id, ac.slug, ac.display_name, ac.purpose,
    ac.default_model, ac.default_context_profile,
    ac.safety_level::text, ac.max_loops,
    ac.allowed_tools, ac.denied_tools,
    ac.model_overrides, ac.autonomy_level::text,
    ac.is_active,
    ac.created_at, ac.updated_at
  FROM agent_catalog ac
  ORDER BY ac.slug;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_agent_catalog_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_catalog_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_catalog_admin() TO service_role;
