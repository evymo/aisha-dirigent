-- Function: public.prevent_system_role_deletion
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:58+01:00

CREATE OR REPLACE FUNCTION public.prevent_system_role_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.is_system = true THEN
    RAISE EXCEPTION 'Cannot delete system roles' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.prevent_system_role_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_system_role_deletion() TO authenticated;
