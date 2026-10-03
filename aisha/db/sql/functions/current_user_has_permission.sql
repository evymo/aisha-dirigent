-- Function: public.current_user_has_permission
-- Arguments: p_permission_code text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:20+01:00

CREATE OR REPLACE FUNCTION public.current_user_has_permission(p_permission_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT public.has_permission(auth.uid(), p_permission_code);
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.current_user_has_permission(p_permission_code text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_has_permission(p_permission_code text) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_permission(p_permission_code text) TO authenticated;
