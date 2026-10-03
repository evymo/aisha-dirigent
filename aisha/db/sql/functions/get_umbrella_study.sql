-- Function: public.get_umbrella_study
-- Arguments: (none)
-- Description: Returns umbrella study info. Public study data.
-- Security: SECURITY DEFINER - public read-only study info.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_umbrella_study()
 RETURNS TABLE(id uuid, code text, name text, is_umbrella boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.code,
    s.name,
    (COALESCE(s.is_umbrella, false) OR s.code = 'umbrella') AS is_umbrella
  FROM public.studies s
  WHERE COALESCE(s.is_umbrella, false) = true
     OR s.code = 'umbrella'
  ORDER BY (COALESCE(s.is_umbrella, false) OR s.code = 'umbrella') DESC, s.created_at DESC
  LIMIT 1;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_umbrella_study() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_umbrella_study() TO public;
