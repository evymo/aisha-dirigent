-- Function: create_consultation_booking_audited
-- Purpose: Create a new consultation booking, auto-create story, audit log

CREATE OR REPLACE FUNCTION create_consultation_booking_audited(
  p_specialist_id uuid,
  p_duration_hours numeric DEFAULT 4,
  p_scheduled_start timestamptz DEFAULT NULL,
  p_description text DEFAULT '',
  p_tags text[] DEFAULT '{}',
  p_preferred_communication text DEFAULT 'written',
  p_urgency text DEFAULT 'normal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_member_id uuid;
  v_pricing RECORD;
  v_price numeric(10,2);
  v_booking_id uuid;
  v_story_id uuid;
BEGIN
  v_member_id := auth.uid();
  IF v_member_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- 1. Get specialist pricing
  SELECT sp.*, pp.user_id AS specialist_user_id, pp.display_name
  INTO v_pricing
  FROM specialist_pricing sp
  JOIN partner_profiles pp ON pp.id = sp.partner_id
  WHERE sp.partner_id = p_specialist_id
    AND sp.is_active = true;

  IF v_pricing IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Specialist pricing not found or inactive');
  END IF;

  -- 2. Validate duration meets minimum
  IF p_duration_hours < v_pricing.min_block_hours THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Minimum block is ' || v_pricing.min_block_hours || ' hours');
  END IF;

  -- 3. Check specialist capacity
  IF (SELECT COUNT(*) FROM consultation_bookings
      WHERE specialist_id = p_specialist_id
        AND status IN ('confirmed', 'in_progress'))
     >= v_pricing.max_concurrent_projects THEN
    RETURN jsonb_build_object('success', false, 'error', 'Specialist at capacity');
  END IF;

  -- 4. Calculate price
  v_price := ROUND(v_pricing.hourly_rate * p_duration_hours, 2);

  -- 5. Create story for this consultation
  INSERT INTO partner_stories (
    partner_id, user_id, title, status, priority, origin, delivery_status
  ) VALUES (
    p_specialist_id, v_member_id,
    'Konzultace s ' || v_pricing.display_name,
    'inbox', 'normal', 'marketplace', 'analyzing'
  )
  RETURNING id INTO v_story_id;

  -- 6. Create booking
  INSERT INTO consultation_bookings (
    member_id, specialist_id, story_id,
    scheduled_start,
    scheduled_end,
    duration_hours, price, currency, status
  ) VALUES (
    v_member_id, p_specialist_id, v_story_id,
    p_scheduled_start,
    CASE WHEN p_scheduled_start IS NOT NULL
      THEN p_scheduled_start + (p_duration_hours || ' hours')::interval
      ELSE NULL END,
    p_duration_hours, v_price, v_pricing.currency, 'pending_payment'
  )
  RETURNING id INTO v_booking_id;

  -- 7. Create booking requirements
  INSERT INTO booking_requirements (
    booking_id, description, tags, preferred_communication, urgency
  ) VALUES (
    v_booking_id, p_description, p_tags, p_preferred_communication, p_urgency
  );

  -- 8. Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_member_id,
    'BOOKING_CREATED',
    jsonb_build_object(
      'area', 'marketplace',
      'severity', 'info',
      'entity_type', 'consultation_booking',
      'entity_id', v_booking_id,
      'specialist_id', p_specialist_id,
      'price', v_price,
      'duration_hours', p_duration_hours
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'story_id', v_story_id,
    'price', v_price,
    'currency', v_pricing.currency
  );
END;
$$;

REVOKE ALL ON FUNCTION create_consultation_booking_audited(uuid,numeric,timestamptz,text,text[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_consultation_booking_audited(uuid,numeric,timestamptz,text,text[],text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION create_consultation_booking_audited(uuid,numeric,timestamptz,text,text[],text,text) TO service_role;
