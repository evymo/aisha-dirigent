-- Function: public.get_all_supported_languages
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:34+01:00

CREATE OR REPLACE FUNCTION public.get_all_supported_languages()
 RETURNS SETOF supported_languages
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    code,
    name_native,
    name_key,
    is_active,
    is_default,
    sort_order,
    created_at,
    updated_at
  FROM public.supported_languages
  ORDER BY sort_order, code;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_all_supported_languages() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_all_supported_languages() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_all_supported_languages() TO authenticated;
