-- Function: rate_specialist_audited
-- Purpose: Client rates specialist after booking completion

CREATE OR REPLACE FUNCTION rate_specialist_audited(
  p_booking_id uuid,
  p_rating_overall int,
  p_rating_communication int DEFAULT NULL,
  p_rating_expertise int DEFAULT NULL,
  p_rating_delivery int DEFAULT NULL,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_booking RECORD;
  v_rating_id uuid;
  v_avg_rating numeric;
  v_total_count int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Validate rating range
  IF p_rating_overall < 1 OR p_rating_overall > 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rating must be 1-5');
  END IF;

  -- Get booking and verify ownership
  SELECT cb.*
  INTO v_booking
  FROM consultation_bookings cb
  WHERE cb.id = p_booking_id;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.member_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not your booking');
  END IF;

  IF v_booking.status != 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not yet completed');
  END IF;

  -- Check if already rated
  IF EXISTS (
    SELECT 1 FROM specialist_ratings
    WHERE booking_id = p_booking_id AND rater_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already rated');
  END IF;

  -- Create rating
  INSERT INTO specialist_ratings (
    rated_specialist_id, rater_id, booking_id, story_id,
    overall_rating, communication_rating, expertise_rating, value_rating,
    review_text
  ) VALUES (
    v_booking.specialist_id, v_user_id, p_booking_id, v_booking.story_id,
    p_rating_overall,
    COALESCE(p_rating_communication, p_rating_overall),
    COALESCE(p_rating_expertise, p_rating_overall),
    COALESCE(p_rating_delivery, p_rating_overall),
    p_comment
  )
  RETURNING id INTO v_rating_id;

  -- Update specialist avg_rating
  SELECT AVG(overall_rating), COUNT(*)
  INTO v_avg_rating, v_total_count
  FROM specialist_ratings
  WHERE rated_specialist_id = v_booking.specialist_id;

  UPDATE partner_profiles
  SET avg_rating = ROUND(v_avg_rating, 2),
      total_ratings_count = v_total_count
  WHERE id = v_booking.specialist_id;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'SPECIALIST_RATED',
    jsonb_build_object(
      'area', 'marketplace',
      'severity', 'info',
      'entity_type', 'specialist_rating',
      'entity_id', v_rating_id,
      'specialist_id', v_booking.specialist_id,
      'rating_overall', p_rating_overall
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'rating_id', v_rating_id,
    'new_avg_rating', v_avg_rating
  );
END;
$$;

REVOKE ALL ON FUNCTION rate_specialist_audited(uuid,int,int,int,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_specialist_audited(uuid,int,int,int,int,text) TO authenticated;
GRANT EXECUTE ON FUNCTION rate_specialist_audited(uuid,int,int,int,int,text) TO service_role;
