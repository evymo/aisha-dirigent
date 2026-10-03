-- Function: public.get_agent_catalog_entry
-- Arguments: p_slug text
-- Returns: Single row from agent_catalog for a given slug
-- Security: SECURITY DEFINER (service_role only — used by proactive engine)
-- Purpose: Lookup agent metadata (autonomy_level, safety_level) for runtime checks

CREATE OR REPLACE FUNCTION public.get_agent_catalog_entry(
  p_slug text
)
RETURNS TABLE(
  slug text,
  autonomy_level text,
  safety_level text,
  is_active boolean,
  default_model text,
  default_context_profile text,
  max_loops integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Auth check: service_role only
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied: service_role only';
  END IF;

  RETURN QUERY
  SELECT
    ac.slug,
    ac.autonomy_level,
    ac.safety_level::text,
    ac.is_active,
    ac.default_model,
    ac.default_context_profile,
    ac.max_loops
  FROM agent_catalog ac
  WHERE ac.slug = p_slug;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_agent_catalog_entry(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_catalog_entry(text) TO service_role;
