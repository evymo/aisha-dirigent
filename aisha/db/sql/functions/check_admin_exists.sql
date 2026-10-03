-- Function: public.check_admin_exists
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:55+01:00

CREATE OR REPLACE FUNCTION public.check_admin_exists()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Simply check if any admin user exists (no PII returned)
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE role = 'admin'
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.check_admin_exists() FROM PUBLIC;
-- No GRANT - internal/helper function
