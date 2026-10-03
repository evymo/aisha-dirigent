-- Function: public.check_profile_complete
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:57+01:00

CREATE OR REPLACE FUNCTION public.check_profile_complete()
 RETURNS TABLE(is_complete boolean, missing_fields text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile RECORD;
  v_missing TEXT[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT false, ARRAY['Not authenticated']::TEXT[];
    RETURN;
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE user_id = auth.uid();

  IF v_profile IS NULL THEN
    RETURN QUERY SELECT false, ARRAY['profile']::TEXT[];
    RETURN;
  END IF;

  IF v_profile.display_name IS NULL OR v_profile.display_name = '' THEN
    v_missing := array_append(v_missing, 'display_name');
  END IF;

  RETURN QUERY SELECT (array_length(v_missing, 1) IS NULL OR array_length(v_missing, 1) = 0), v_missing;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.check_profile_complete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_profile_complete() TO authenticated;
