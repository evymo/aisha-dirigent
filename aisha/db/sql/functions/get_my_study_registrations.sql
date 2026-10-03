-- Function: public.get_my_study_registrations
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_my_study_registrations()
 RETURNS TABLE(id uuid, study_id uuid, study_name text, study_code text, status text, group_assignment text, enrolled_at timestamptz, completed_at timestamptz, consultant_id uuid, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT 
    se.id,
    se.study_id,
    s.name as study_name,
    s.code as study_code,
    se.status::text,
    se.group_assignment,
    se.enrolled_at,
    se.completed_at,
    se.consultant_id,
    se.created_at
  FROM study_registrations se
  JOIN studies s ON s.id = se.study_id
  WHERE se.user_id = auth.uid()
  ORDER BY se.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_study_registrations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_study_registrations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_study_registrations() TO service_role;
