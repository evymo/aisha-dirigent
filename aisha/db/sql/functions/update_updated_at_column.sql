-- Function: public.update_updated_at_column
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:32+01:00

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
SET search_path TO 'public'
 SET search_path = public
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

-- Trigger functions: REVOKE to prevent direct invocation
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
