-- Function: public.has_section_access
-- Arguments: p_user_id uuid, p_section text, p_permission text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:52+01:00

CREATE OR REPLACE FUNCTION public.has_section_access(p_user_id uuid, p_section text, p_permission text DEFAULT 'read'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 
    FROM public.role_permissions rp
    JOIN public.user_roles ur ON ur.role = rp.role
    WHERE ur.user_id = p_user_id
    AND rp.section::text = p_section
    AND rp.permission::text = p_permission
  );
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.has_section_access(p_user_id uuid, p_section text, p_permission text) FROM PUBLIC;
-- No GRANT - internal/helper function
