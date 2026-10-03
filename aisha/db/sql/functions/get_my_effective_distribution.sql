-- Function: public.get_my_effective_distribution
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_my_effective_distribution()
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

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT 
      p.id AS product_id,
      p.name AS product_name,
      dp.id AS protocol_id,
      dp.name AS protocol_name,
      COALESCE(da.new_dose_amount, dp.dose_amount)::NUMERIC AS dose_amount,
      dp.dose_unit,
      COALESCE(da.new_doses_per_day, dp.doses_per_day)::INTEGER AS doses_per_day,
      COALESCE(da.new_dose_timing, dp.dose_timing) AS dose_timing,
      dp.arm_code,
      CASE 
        WHEN da.id IS NOT NULL THEN 'adjustment'
        ELSE 'study'
      END AS source,
      s.name AS study_name,
      -- Calculate ml_per_day based on dose_unit
      CASE dp.dose_unit
        WHEN 'ml' THEN COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day)
        WHEN 'drops' THEN (COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day)) * 0.05
        WHEN 'sprays' THEN (COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day)) * 0.1
        ELSE COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day)
      END::NUMERIC AS ml_per_day,
      -- Calculate ml_per_month (30 days)
      CASE dp.dose_unit
        WHEN 'ml' THEN COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day) * 30
        WHEN 'drops' THEN (COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day)) * 0.05 * 30
        WHEN 'sprays' THEN (COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day)) * 0.1 * 30
        ELSE COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day) * 30
      END::NUMERIC AS ml_per_month,
      -- Calculate bottle_lasts_days (30ml bottle)
      CASE 
        WHEN COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day) > 0 THEN
          CASE dp.dose_unit
            WHEN 'ml' THEN 30.0 / (COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day))
            WHEN 'drops' THEN 30.0 / ((COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day)) * 0.05)
            WHEN 'sprays' THEN 30.0 / ((COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day)) * 0.1)
            ELSE 30.0 / (COALESCE(da.new_dose_amount, dp.dose_amount) * COALESCE(da.new_doses_per_day, dp.doses_per_day))
          END
        ELSE 30
      END::INTEGER AS bottle_lasts_days
    FROM study_registrations se
    JOIN studies s ON se.study_id = s.id
    JOIN distribution_protocols dp ON dp.study_id = s.id AND dp.is_active = true
    JOIN products p ON dp.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT id, new_dose_amount, new_doses_per_day, new_dose_timing
      FROM distribution_adjustments
      WHERE member_token = (SELECT member_token FROM profiles WHERE user_id = v_user_id LIMIT 1)
        AND (protocol_id IS NULL OR protocol_id = dp.id)
        AND is_active = true
        AND effective_from <= CURRENT_DATE
        AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
      ORDER BY created_at DESC
      LIMIT 1
    ) da ON true
    WHERE se.user_id = v_user_id
      AND se.status = 'active'
      AND dp.product_id IS NOT NULL
  ) t;

  -- Audit
  INSERT INTO audit_journal (user_id, action, action_type, area, entity_type, summary, severity)
  VALUES (v_user_id, 'view', 'view', 'members', 'distribution', 'Viewed effective distribution', 'info');

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_effective_distribution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_effective_distribution() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_effective_distribution() TO service_role;
