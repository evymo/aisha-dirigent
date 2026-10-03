-- Function: public.get_supported_languages
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:38+01:00

CREATE OR REPLACE FUNCTION public.get_supported_languages()
 RETURNS SETOF supported_languages
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT sl.*
  FROM public.supported_languages sl
  WHERE sl.is_active = true
  ORDER BY sl.is_default DESC, sl.sort_order ASC, sl.code ASC;
$function$
;

-- Permissions (PUBLIC: languages must be visible to everyone including anonymous users)
REVOKE ALL ON FUNCTION public.get_supported_languages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supported_languages() TO anon;
GRANT EXECUTE ON FUNCTION public.get_supported_languages() TO authenticated;
