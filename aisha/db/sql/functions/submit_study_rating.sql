-- Function: public.submit_study_rating
-- Arguments: p_study_id uuid, p_rating integer, p_comment text, p_registration_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:09+01:00

CREATE OR REPLACE FUNCTION public.submit_study_rating(p_study_id uuid, p_rating integer, p_comment text DEFAULT NULL::text, p_registration_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_rating_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Check if user already has a rating for this study
  SELECT id INTO v_rating_id
  FROM study_ratings
  WHERE study_id = p_study_id AND user_id = v_user_id;
  
  IF v_rating_id IS NOT NULL THEN
    -- Update existing rating
    UPDATE study_ratings
    SET rating = p_rating,
        review = p_comment,
        registration_id = COALESCE(p_registration_id, registration_id)
    WHERE id = v_rating_id;
  ELSE
    -- Insert new rating
    INSERT INTO study_ratings (study_id, user_id, rating, review, registration_id, is_visible)
    VALUES (p_study_id, v_user_id, p_rating, p_comment, p_registration_id, true)
    RETURNING id INTO v_rating_id;
  END IF;
  
  RETURN v_rating_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_study_rating(p_study_id uuid, p_rating integer, p_comment text, p_registration_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_study_rating(p_study_id uuid, p_rating integer, p_comment text, p_registration_id uuid) TO authenticated;
