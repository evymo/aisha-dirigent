-- Function: public.get_my_study_rating
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:05+01:00

CREATE OR REPLACE FUNCTION public.get_my_study_rating(p_study_id uuid)
 RETURNS TABLE(id uuid, study_id uuid, registration_id uuid, user_id uuid, rating integer, comment text, is_visible boolean, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    sr.id,
    sr.study_id,
    sr.registration_id,
    sr.user_id,
    sr.rating,
    sr.comment,
    sr.is_visible,
    sr.created_at
  FROM study_ratings sr
  WHERE sr.study_id = p_study_id
    AND sr.user_id = v_user_id
  LIMIT 1;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_study_rating(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_study_rating(p_study_id uuid) TO authenticated;
