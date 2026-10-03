-- Function: public.get_user_app_permissions_catalog
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:46+01:00

CREATE OR REPLACE FUNCTION public.get_user_app_permissions_catalog()
 RETURNS TABLE(permission_code text, permission_name text, category text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT
    p.code,
    p.name,
    p.category
  FROM public.user_roles ur
  JOIN public.app_role_permissions rp ON rp.role = ur.role
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = auth.uid()
  ORDER BY p.category, p.code;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_user_app_permissions_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_app_permissions_catalog() TO authenticated;
