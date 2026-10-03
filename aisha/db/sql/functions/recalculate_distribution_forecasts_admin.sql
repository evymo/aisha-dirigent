-- Function: public.recalculate_distribution_forecasts_admin
-- Arguments: p_month date, p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:59+01:00

CREATE OR REPLACE FUNCTION public.recalculate_distribution_forecasts_admin(p_month date DEFAULT NULL::date, p_study_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_month date;
  v_rec RECORD;
  v_total_members integer;
  v_vip_members integer;
  v_daily_dose_ml numeric;
  v_monthly_consumption numeric;
  v_deviation_percent numeric;
  v_deviation_sample integer;
  v_adjusted_consumption numeric;
  v_required_packages numeric;
  v_product_price numeric;
  v_compensated_value numeric;
  v_package_size_ml numeric := 30.0; -- Standard 30ml bottle
  v_drops_to_ml numeric := 0.05; -- 1 drop ≈ 0.05ml (20 drops per ml)
BEGIN
  -- Authorization check
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: Admin or staff access required';
  END IF;

  -- Default to current month if not specified
  v_target_month := COALESCE(p_month, date_trunc('month', CURRENT_DATE)::date);

  -- Iterate over all active study+product combinations from distribution_protocols
  FOR v_rec IN
    SELECT DISTINCT
      dp.study_id,
      dp.product_id,
      dp.dose_amount,
      dp.dose_unit,
      dp.doses_per_day,
      s.parent_study_id,
      p.price
    FROM distribution_protocols dp
    JOIN studies s ON s.id = dp.study_id
    JOIN products p ON p.id = dp.product_id
    WHERE dp.is_active = true
      AND s.is_active = true
      AND (p_study_id IS NULL OR dp.study_id = p_study_id)
  LOOP
    -- 1. Count total active members in this study
    SELECT COUNT(DISTINCT se.user_id)
    INTO v_total_members
    FROM study_registrations se
    WHERE se.study_id = v_rec.study_id
      AND se.status = 'active';

    -- 2. Count VIP members (those in child studies - where study has parent_study_id)
    IF v_rec.parent_study_id IS NOT NULL THEN
      -- This IS a child study, so all its members are VIP
      v_vip_members := v_total_members;
    ELSE
      -- This is umbrella study, VIP are those who are ALSO in child studies
      SELECT COUNT(DISTINCT se_child.user_id)
      INTO v_vip_members
      FROM study_registrations se_umbrella
      JOIN study_registrations se_child ON se_child.user_id = se_umbrella.user_id
      JOIN studies s_child ON s_child.id = se_child.study_id AND s_child.parent_study_id = v_rec.study_id
      WHERE se_umbrella.study_id = v_rec.study_id
        AND se_umbrella.status = 'active'
        AND se_child.status = 'active';
    END IF;

    -- 3. Calculate default daily dose in ml
    IF v_rec.dose_unit = 'drops' THEN
      v_daily_dose_ml := v_rec.dose_amount * v_rec.doses_per_day * v_drops_to_ml;
    ELSIF v_rec.dose_unit = 'ml' THEN
      v_daily_dose_ml := v_rec.dose_amount * v_rec.doses_per_day;
    ELSE
      -- Default assumption for unknown units
      v_daily_dose_ml := v_rec.dose_amount * v_rec.doses_per_day * v_drops_to_ml;
    END IF;

    -- 4. Calculate monthly consumption (all members × daily dose × 30 days)
    v_monthly_consumption := v_total_members * v_daily_dose_ml * 30;

    -- 5. Calculate deviation from dosing_logs (last 3 months)
    -- Deviation = AVG(actual_dose / expected_dose) - 1
    -- Positive = over-consumption, Negative = under-consumption
    SELECT 
      COALESCE(
        AVG(
          CASE 
            WHEN dl.dose_count IS NOT NULL AND v_rec.doses_per_day > 0 THEN
              (dl.dose_count::numeric / v_rec.doses_per_day::numeric) - 1
            WHEN dl.dose_amount IS NOT NULL AND v_rec.dose_amount > 0 THEN
              (CAST(dl.dose_amount AS numeric) / v_rec.dose_amount) - 1
            ELSE 0
          END
        ) * 100, -- Convert to percentage
        0
      ),
      COUNT(dl.id)
    INTO v_deviation_percent, v_deviation_sample
    FROM dosing_logs dl
    JOIN study_registrations se ON se.id = dl.study_registration_id
    WHERE se.study_id = v_rec.study_id
      AND dl.product_id = v_rec.product_id
      AND dl.logged_at >= (v_target_month - INTERVAL '3 months')
      AND dl.logged_at < v_target_month;

    -- 6. Adjust monthly consumption by deviation
    v_adjusted_consumption := v_monthly_consumption * (1 + (v_deviation_percent / 100));

    -- 7. Calculate required packages (ceil to whole bottles)
    IF v_package_size_ml > 0 THEN
      v_required_packages := CEIL(v_adjusted_consumption / v_package_size_ml);
    ELSE
      v_required_packages := 0;
    END IF;

    -- 8. Calculate compensated value (VIP members × product price)
    -- This represents the value of products delivered within the subscription
    v_product_price := COALESCE(v_rec.price, 0);
    v_compensated_value := v_vip_members * v_product_price;

    -- UPSERT the forecast item
    INSERT INTO distribution_forecast_items (
      forecast_month,
      study_id,
      product_id,
      total_members,
      vip_members,
      required_packages,
      compensated_value,
      reported_deviation_percent,
      deviation_sample_size,
      production_status,
      updated_at
    )
    VALUES (
      v_target_month,
      v_rec.study_id,
      v_rec.product_id,
      v_total_members,
      v_vip_members,
      v_required_packages,
      v_compensated_value,
      v_deviation_percent,
      v_deviation_sample,
      'planning',
      now()
    )
    ON CONFLICT (forecast_month, study_id, product_id)
    DO UPDATE SET
      total_members = EXCLUDED.total_members,
      vip_members = EXCLUDED.vip_members,
      required_packages = EXCLUDED.required_packages,
      compensated_value = EXCLUDED.compensated_value,
      reported_deviation_percent = EXCLUDED.reported_deviation_percent,
      deviation_sample_size = EXCLUDED.deviation_sample_size,
      updated_at = now();

  END LOOP;

  -- Audit log
  INSERT INTO audit_journal (action, 
    action_type,
    area,
    entity_type,
    summary,
    user_id,
    details,
    severity
  ) VALUES ('RECALCULATE_DISTRIBUTION_FORECASTS_ADMIN', 
    'update',
    'production',
    'distribution_forecast_items',
    'Distribution forecast recalculated for ' || v_target_month::text,
    auth.uid(),
    jsonb_build_object(
      'month', v_target_month,
      'study_id', p_study_id,
      'calculation_method', 'full_with_deviations'
    ),
    'info'
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.recalculate_distribution_forecasts_admin(p_month date, p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_distribution_forecasts_admin(p_month date, p_study_id uuid) TO authenticated;
