-- Function: get_member_diary_for_partner_audited
-- Returns member diary view for partners with consent
-- Security: DEFINER with audit trail and consent check
-- Created: 2026-01-17

CREATE OR REPLACE FUNCTION public.get_member_diary_for_partner_audited(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_has_consent boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if partner has consent
  SELECT EXISTS(
    SELECT 1 FROM data_sharing_consents dsc
    JOIN partner_profiles pp ON pp.user_id = auth.uid()
    WHERE dsc.user_id = p_member_id 
      AND dsc.partner_id = pp.id
      AND dsc.revoked_at IS NULL
      AND (dsc.expires_at IS NULL OR dsc.expires_at > now())
  ) INTO v_has_consent;

  IF NOT v_has_consent THEN
    RAISE EXCEPTION 'No valid data sharing consent';
  END IF;

  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary)
  VALUES (auth.uid(), 'read', 'member_diary_partner_view', p_member_id::text, 'partner', 'info', 
          'Partner viewed member diary');

  SELECT jsonb_build_object(
    'health_logs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', mhl.id,
        'state_name', COALESCE(mhs.custom_name, mhs.name_key),
        'severity', mhl.severity,
        'logged_at', mhl.logged_at,
        'started_at', mhl.started_at,
        'ended_at', mhl.ended_at,
        'notes', mhl.notes
      ) ORDER BY mhl.logged_at DESC)
      FROM member_health_logs mhl
      JOIN member_health_states mhs ON mhs.id = mhl.state_id
      WHERE mhl.user_id = p_member_id
      LIMIT 50
    ), '[]'::jsonb),
    'health_states', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', mhs.id,
        'name', COALESCE(mhs.custom_name, mhs.name_key),
        'icon', mhs.icon,
        'color', mhs.color,
        'is_active', mhs.is_active
      ))
      FROM member_health_states mhs
      WHERE mhs.user_id = p_member_id AND mhs.is_active = true
    ), '[]'::jsonb),
    'product_logs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', msl.id,
        'plan_id', msl.plan_id,
        'logged_at', msl.logged_at,
        'dose_taken', msl.dose_taken,
        'notes', msl.notes
      ) ORDER BY msl.logged_at DESC)
      FROM member_product_logs msl
      WHERE msl.user_id = p_member_id
      LIMIT 50
    ), '[]'::jsonb),
    'product_plans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', msp.id,
        'name', COALESCE(p.name, ms.name),
        'dose_amount', msp.dose_amount,
        'dose_unit', msp.dose_unit,
        'doses_per_day', msp.doses_per_day,
        'is_active', msp.is_active
      ))
      FROM member_product_plans msp
      LEFT JOIN products p ON p.id = msp.product_id
      LEFT JOIN member_products ms ON ms.id = msp.product_id
      WHERE msp.user_id = p_member_id AND msp.is_active = true
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_member_diary_for_partner_audited(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_member_diary_for_partner_audited(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_member_diary_for_partner_audited(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_member_diary_for_partner_audited(uuid) IS 
'Returns member diary data for partners with valid data sharing consent. Audited.';
