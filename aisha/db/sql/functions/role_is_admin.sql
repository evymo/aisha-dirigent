-- Function: public.role_is_admin
-- Arguments: _role app_role
-- Description: Checks if a role is an admin role.
-- Security: SECURITY DEFINER with search_path set.
-- Synced with migration: 20260102225957

CREATE OR REPLACE FUNCTION public.role_is_admin(_role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT is_admin FROM public.roles WHERE name = _role), false)
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.role_is_admin(_role app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.role_is_admin(_role app_role) TO authenticated;
