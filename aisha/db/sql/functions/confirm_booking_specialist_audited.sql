-- Function: confirm_booking_specialist_audited
-- Purpose: Specialist confirms/rejects a booking

-- p_action: 'confirm' or 'reject'
CREATE OR REPLACE FUNCTION confirm_booking_specialist_audited(
  p_booking_id uuid,
  p_action text,
  p_reject_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_booking RECORD;
  v_new_status booking_status;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- 1. Get booking and verify specialist ownership
  SELECT cb.*, pp.user_id AS specialist_user_id
  INTO v_booking
  FROM consultation_bookings cb
  JOIN partner_profiles pp ON pp.id = cb.specialist_id
  WHERE cb.id = p_booking_id;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.specialist_user_id != v_user_id AND NOT is_admin_or_staff() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF v_booking.status NOT IN ('pending_payment', 'confirmed') THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Booking status ' || v_booking.status || ' cannot be changed');
  END IF;

  -- 2. Determine new status
  IF p_action = 'confirm' THEN
    v_new_status := 'confirmed';
  ELSIF p_action = 'reject' THEN
    v_new_status := 'cancelled';
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  -- 3. Update booking
  UPDATE consultation_bookings
  SET status = v_new_status,
      updated_at = now()
  WHERE id = p_booking_id;

  -- 4. If rejected, cancel the story
  IF p_action = 'reject' THEN
    UPDATE partner_stories
    SET status = 'cancelled'
    WHERE id = v_booking.story_id;
  END IF;

  -- 5. Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'BOOKING_' || UPPER(p_action) || 'ED',
    jsonb_build_object(
      'area', 'marketplace',
      'severity', CASE WHEN p_action = 'reject' THEN 'warning' ELSE 'info' END,
      'entity_type', 'consultation_booking',
      'entity_id', p_booking_id,
      'previous_status', v_booking.status,
      'new_status', v_new_status,
      'reject_reason', COALESCE(p_reject_reason, '')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'new_status', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION confirm_booking_specialist_audited(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_booking_specialist_audited(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_booking_specialist_audited(uuid,text,text) TO service_role;
