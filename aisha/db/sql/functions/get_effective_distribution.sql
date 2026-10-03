-- Function: public.get_effective_distribution
-- Arguments: p_member_token uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_effective_distribution(p_member_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authorization: admin/staff or consultant with consent
  IF NOT is_admin_or_staff(v_user_id) AND NOT has_role(v_user_id, 'practitioner') THEN
    RAISE EXCEPTION 'Access denied: requires admin, staff or practitioner role';
  END IF;

  -- Get effective distribution from member_distribution_plans with any active adjustments
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT 
      mdp.id AS plan_id,
      sdp.id AS protocol_id,
      p.name AS product_name,
      s.name AS study_name,
      sdp.arm_code,
      COALESCE(da.new_dose_amount, mdp.dose_amount) AS dose_amount,
      mdp.dose_unit,
      COALESCE(da.new_doses_per_day, mdp.doses_per_day) AS doses_per_day,
      COALESCE(da.new_dose_timing, mdp.dose_timing) AS dose_timing,
      mdp.effective_from,
      mdp.effective_until,
      da.id IS NOT NULL AS has_adjustment,
      da.adjustment_type,
      da.reason AS adjustment_reason,
      da.effective_from AS adjustment_from,
      da.effective_until AS adjustment_until
    FROM member_distribution_plans mdp
    LEFT JOIN study_distribution_protocols sdp ON mdp.protocol_id = sdp.id
    LEFT JOIN studies s ON sdp.study_id = s.id
    LEFT JOIN products p ON sdp.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT
        adj.id,
        adj.new_dose_amount,
        adj.new_doses_per_day,
        adj.new_dose_timing,
        adj.adjustment_type,
        adj.reason,
        adj.effective_from,
        adj.effective_until
      FROM distribution_adjustments adj
      WHERE adj.member_token = mdp.member_token
        AND (adj.protocol_id IS NULL OR adj.protocol_id = sdp.id)
        AND adj.is_active = true
        AND adj.effective_from <= CURRENT_DATE
        AND (adj.effective_until IS NULL OR adj.effective_until >= CURRENT_DATE)
      ORDER BY adj.created_at DESC
      LIMIT 1
    ) da ON true
    WHERE mdp.member_token = p_member_token
      AND mdp.is_active = true
      AND (mdp.effective_until IS NULL OR mdp.effective_until >= CURRENT_DATE)
    ORDER BY mdp.created_at DESC
  ) t;

  -- Audit log (sensitive data access)
  INSERT INTO audit_journal (user_id, action_type, area, entity_type, summary, severity, details)
  VALUES (
    v_user_id, 
    'view', 
    'admin', 
    'distribution', 
    'Viewed effective distribution for member', 
    'info',
    jsonb_build_object('member_token', p_member_token)
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_effective_distribution(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_distribution(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_distribution(uuid) TO service_role;
