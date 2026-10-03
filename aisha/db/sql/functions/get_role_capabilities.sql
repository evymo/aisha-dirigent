-- Function: public.get_role_capabilities
-- Arguments: _role app_role
-- Description: Returns capabilities for a given role.
-- Security: SECURITY DEFINER with search_path set.
-- Synced with migration: 20260102225957

CREATE OR REPLACE FUNCTION public.get_role_capabilities(_role app_role)
 RETURNS TABLE(is_admin boolean, is_system boolean, can_manage_users boolean, can_manage_roles boolean, can_view_phi boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.is_admin, r.is_system, r.can_manage_users, r.can_manage_roles, r.can_view_phi
  FROM public.roles r
  WHERE r.name = _role
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_role_capabilities(_role app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_role_capabilities(_role app_role) TO authenticated;
