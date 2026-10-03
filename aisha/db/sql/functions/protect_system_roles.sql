-- Function: public.protect_system_roles
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:59+01:00

CREATE OR REPLACE FUNCTION public.protect_system_roles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.is_system = true AND NEW.is_system = false THEN
    RAISE EXCEPTION 'Cannot remove system role protection' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.is_system = true AND OLD.is_admin != NEW.is_admin THEN
    RAISE EXCEPTION 'Cannot change admin status of system roles' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.is_system = true AND OLD.name != NEW.name THEN
    RAISE EXCEPTION 'Cannot rename system roles' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.protect_system_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_system_roles() TO authenticated;
