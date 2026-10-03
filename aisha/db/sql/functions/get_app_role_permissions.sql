-- Function: public.get_app_role_permissions
-- Arguments: p_role app_role
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:34+01:00

CREATE OR REPLACE FUNCTION public.get_app_role_permissions(p_role app_role)
 RETURNS TABLE(permission_id uuid, code text, name text, description text, category text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.code, p.name, p.description, p.category
  FROM public.app_role_permissions rp
  JOIN public.permissions p ON rp.permission_id = p.id
  WHERE rp.role = p_role
  ORDER BY p.category, p.name;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_app_role_permissions(p_role app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_app_role_permissions(p_role app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_app_role_permissions(p_role app_role) TO authenticated;
