-- Function: complete_booking_audited
-- Purpose: Complete a booking, create project_revenue record, trigger revenue split

CREATE OR REPLACE FUNCTION complete_booking_audited(
  p_booking_id uuid,
  p_actual_hours numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_booking RECORD;
  v_actual_hours numeric;
  v_final_price numeric(10,2);
  v_revenue_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- 1. Get booking
  SELECT cb.*, pp.user_id AS specialist_user_id
  INTO v_booking
  FROM consultation_bookings cb
  JOIN partner_profiles pp ON pp.id = cb.specialist_id
  WHERE cb.id = p_booking_id;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Only specialist or admin can complete
  IF v_booking.specialist_user_id != v_user_id AND NOT is_admin_or_staff() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF v_booking.status != 'in_progress' AND v_booking.status != 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Cannot complete booking with status ' || v_booking.status);
  END IF;

  -- 2. Calculate final hours and price
  v_actual_hours := COALESCE(p_actual_hours, v_booking.duration_hours);
  v_final_price := ROUND(
    (v_booking.price / v_booking.duration_hours) * v_actual_hours, 2
  );

  -- 3. Update booking
  UPDATE consultation_bookings
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE id = p_booking_id;

  -- 4. Update story delivery status
  UPDATE partner_stories
  SET delivery_status = 'delivered'
  WHERE id = v_booking.story_id;

  -- 5. Create project_revenue record
  INSERT INTO project_revenue (
    story_id, booking_id, revenue_type,
    total_amount, currency, status
  ) VALUES (
    v_booking.story_id, p_booking_id, 'project',
    v_final_price, v_booking.currency, 'pending'
  )
  RETURNING id INTO v_revenue_id;

  -- 6. Calculate splits immediately
  PERFORM calculate_revenue_split_audited(v_revenue_id);

  -- 7. Update specialist stats
  UPDATE partner_profiles
  SET completed_projects_count = COALESCE(completed_projects_count, 0) + 1,
      active_projects_count = GREATEST(0, COALESCE(active_projects_count, 0) - 1),
      last_active_at = now()
  WHERE id = v_booking.specialist_id;

  -- 8. Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'BOOKING_COMPLETED',
    jsonb_build_object(
      'area', 'marketplace',
      'severity', 'info',
      'entity_type', 'consultation_booking',
      'entity_id', p_booking_id,
      'actual_hours', v_actual_hours,
      'final_price', v_final_price,
      'revenue_id', v_revenue_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'revenue_id', v_revenue_id,
    'final_price', v_final_price,
    'actual_hours', v_actual_hours
  );
END;
$$;

REVOKE ALL ON FUNCTION complete_booking_audited(uuid,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_booking_audited(uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_booking_audited(uuid,numeric) TO service_role;
