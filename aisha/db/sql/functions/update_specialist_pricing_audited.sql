-- Function: update_specialist_pricing_audited
-- Purpose: Specialist updates their own pricing settings

CREATE OR REPLACE FUNCTION update_specialist_pricing_audited(
  p_hourly_rate numeric DEFAULT NULL,
  p_min_block_hours numeric DEFAULT NULL,
  p_max_concurrent_projects int DEFAULT NULL,
  p_instant_booking_enabled boolean DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_partner_id uuid;
  v_pricing_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Get partner_id
  SELECT id INTO v_partner_id
  FROM partner_profiles
  WHERE user_id = v_user_id;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No specialist profile');
  END IF;

  -- Validate rate
  IF p_hourly_rate IS NOT NULL AND p_hourly_rate < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rate cannot be negative');
  END IF;

  -- Upsert pricing
  INSERT INTO specialist_pricing (
    partner_id,
    hourly_rate,
    min_block_hours,
    max_concurrent_projects,
    instant_booking,
    is_active
  ) VALUES (
    v_partner_id,
    COALESCE(p_hourly_rate, 3250),
    COALESCE(p_min_block_hours, 4),
    COALESCE(p_max_concurrent_projects, 3),
    COALESCE(p_instant_booking_enabled, false),
    COALESCE(p_is_active, true)
  )
  ON CONFLICT (partner_id) DO UPDATE SET
    hourly_rate = COALESCE(p_hourly_rate, specialist_pricing.hourly_rate),
    min_block_hours = COALESCE(p_min_block_hours, specialist_pricing.min_block_hours),
    max_concurrent_projects = COALESCE(p_max_concurrent_projects, specialist_pricing.max_concurrent_projects),
    instant_booking = COALESCE(p_instant_booking_enabled, specialist_pricing.instant_booking),
    is_active = COALESCE(p_is_active, specialist_pricing.is_active),
    updated_at = now()
  RETURNING id INTO v_pricing_id;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'PRICING_UPDATED',
    jsonb_build_object(
      'area', 'marketplace',
      'severity', 'info',
      'entity_type', 'specialist_pricing',
      'entity_id', v_pricing_id,
      'hourly_rate', p_hourly_rate,
      'min_block_hours', p_min_block_hours
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'pricing_id', v_pricing_id
  );
END;
$$;

REVOKE ALL ON FUNCTION update_specialist_pricing_audited(numeric,numeric,int,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_specialist_pricing_audited(numeric,numeric,int,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION update_specialist_pricing_audited(numeric,numeric,int,boolean,boolean) TO service_role;
