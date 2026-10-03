-- Function: public.update_system_config_timestamp
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:30+01:00

CREATE OR REPLACE FUNCTION public.update_system_config_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_system_config_timestamp() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_system_config_timestamp() TO authenticated;
