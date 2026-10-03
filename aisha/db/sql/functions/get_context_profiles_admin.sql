-- Function: public.get_context_profiles_admin
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_context_profiles_admin()
 RETURNS TABLE(id uuid, slug text, display_name text, description text, token_budget integer, priority_order text[], layers jsonb, is_active boolean, created_at timestamptz)
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
    cp.id, cp.slug, cp.display_name, cp.description,
    cp.token_budget, cp.priority_order, cp.layers,
    cp.is_active, cp.created_at
  FROM context_profiles cp
  ORDER BY cp.slug;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_context_profiles_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_context_profiles_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_context_profiles_admin() TO service_role;
