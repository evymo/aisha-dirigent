-- Function: public.create_study_rating
-- Arguments: p_study_id uuid, p_rating integer, p_comment text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:16+01:00

CREATE OR REPLACE FUNCTION public.create_study_rating(p_study_id uuid, p_rating integer, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID;
  v_registration_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get user's registration for this study
  SELECT id INTO v_registration_id
  FROM study_registrations
  WHERE user_id = v_user_id AND study_id = p_study_id
  LIMIT 1;

  INSERT INTO study_ratings (study_id, registration_id, user_id, rating, review)
  VALUES (p_study_id, v_registration_id, v_user_id, p_rating, p_comment)
  RETURNING row_to_json(study_ratings)::jsonb INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_study_rating(p_study_id uuid, p_rating integer, p_comment text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_study_rating(p_study_id uuid, p_rating integer, p_comment text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_study_rating(p_study_id uuid, p_rating integer, p_comment text) TO authenticated;
