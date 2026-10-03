-- Function: public.digest
-- Arguments: data text, type text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:28+01:00

CREATE OR REPLACE FUNCTION public.digest(data text, type text)
 RETURNS bytea
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT extensions.digest(data::bytea, type);
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.digest(data text, type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.digest(data text, type text) TO authenticated;
