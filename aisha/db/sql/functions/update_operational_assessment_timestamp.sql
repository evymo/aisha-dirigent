-- Function: public.update_operational_assessment_timestamp
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:15+01:00

CREATE OR REPLACE FUNCTION public.update_operational_assessment_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_operational_assessment_timestamp() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_operational_assessment_timestamp() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_operational_assessment_timestamp() TO authenticated;
