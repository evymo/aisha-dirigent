-- Function: public.get_my_umbrella_registration
-- Arguments: p_study_id uuid DEFAULT NULL::uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_my_umbrella_registration(p_study_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, user_id uuid, study_id uuid, status text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_umbrella_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Get umbrella study ID (use parameter or find from studies table)
  v_umbrella_id := COALESCE(
    p_study_id,
    (SELECT s.id FROM studies s WHERE s.is_umbrella = true LIMIT 1)
  );
  
  IF v_umbrella_id IS NULL THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    se.id,
    se.user_id,
    se.study_id,
    se.status::text,
    se.created_at,
    se.updated_at
  FROM study_registrations se
  WHERE se.user_id = v_user_id
    AND se.study_id = v_umbrella_id
  ORDER BY se.created_at DESC
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_umbrella_registration(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_umbrella_registration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_umbrella_registration(uuid) TO service_role;
