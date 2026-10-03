-- Function: public.get_user_app_permissions
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:46+01:00

CREATE OR REPLACE FUNCTION public.get_user_app_permissions(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    array_agg(DISTINCT p.code),
    ARRAY[]::text[]
  )
  FROM public.user_roles ur
  JOIN public.app_role_permissions rp ON ur.role = rp.role
  JOIN public.permissions p ON rp.permission_id = p.id
  WHERE ur.user_id = COALESCE(p_user_id, auth.uid());
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_user_app_permissions(p_user_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_app_permissions(p_user_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_app_permissions(p_user_id uuid) TO authenticated;
