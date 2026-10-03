-- Function: public.check_umbrella_registration
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.check_umbrella_registration()
 RETURNS TABLE(has_registration boolean, registration_id uuid, registration_status text, study_id uuid, study_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    true as has_registration,
    se.id as registration_id,
    se.status::text as registration_status,
    s.id as study_id,
    s.name as study_name
  FROM study_registrations se
  JOIN studies s ON s.id = se.study_id
  WHERE se.user_id = v_user_id
    AND s.is_umbrella = true
  ORDER BY se.enrolled_at DESC
  LIMIT 1;
  
  -- If no rows returned, return false row
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::uuid, NULL::text;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_umbrella_registration() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_umbrella_registration() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_umbrella_registration() TO service_role;
