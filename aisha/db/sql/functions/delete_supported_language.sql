-- Function: public.delete_supported_language
-- Arguments: p_code text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:27+01:00

CREATE OR REPLACE FUNCTION public.delete_supported_language(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  DELETE FROM supported_languages WHERE code = p_code;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_supported_language(p_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_supported_language(p_code text) TO authenticated;
