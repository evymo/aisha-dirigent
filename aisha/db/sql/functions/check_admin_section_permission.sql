-- Function: public.check_admin_section_permission
-- Arguments: p_section text, p_permission text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:56+01:00

CREATE OR REPLACE FUNCTION public.check_admin_section_permission(p_section text, p_permission text DEFAULT 'read'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_permission(auth.uid(), 'admin_' || p_section || '_' || p_permission)
    OR public.has_role(auth.uid(), 'admin'); -- Admin always has full access
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.check_admin_section_permission(p_section text, p_permission text) FROM PUBLIC;
-- No GRANT - internal/helper function
