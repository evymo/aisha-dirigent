-- Function: public.get_my_user_roles
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:07+01:00

CREATE OR REPLACE FUNCTION public.get_my_user_roles()
 RETURNS TABLE(id uuid, user_id uuid, role app_role, granted_by uuid, granted_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ur.id, ur.user_id, ur.role, ur.granted_by, ur.granted_at
  FROM public.user_roles ur
  WHERE ur.user_id = auth.uid();
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_user_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_user_roles() TO authenticated;
