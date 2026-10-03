-- Function: public.get_distribution_forecasts_admin
-- Arguments: p_month date, p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:46+01:00

CREATE OR REPLACE FUNCTION public.get_distribution_forecasts_admin(p_month date DEFAULT NULL::date, p_study_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, forecast_month date, study_id uuid, product_id uuid, required_packages numeric, compensated_value numeric, total_members integer, vip_members integer, production_status text, reported_deviation_percent numeric, deviation_sample_size integer, linked_batch_id uuid, study_name text, study_code text, product_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month_start date;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff access required';
  END IF;

  v_month_start := COALESCE(date_trunc('month', p_month)::date, date_trunc('month', CURRENT_DATE)::date);
  INSERT INTO audit_journal (
    action, user_id, action_type, entity_type, area, severity, summary, details
  ) VALUES (
    'GET_DISTRIBUTION_FORECASTS_ADMIN', auth.uid(), 'read'::journal_action_type, 'distribution_forecast_items',
    'production'::journal_area, 'info'::journal_severity,
    'Admin viewed distribution forecast items',
    jsonb_build_object('month', v_month_start, 'study_id', p_study_id)
  );

  RETURN QUERY
  SELECT
    dfi.id,
    to_char(dfi.forecast_month, 'YYYY-MM') AS forecast_month,
    dfi.study_id,
    dfi.product_id,
    dfi.required_packages,
    dfi.compensated_value,
    dfi.total_members,
    dfi.vip_members,
    COALESCE(dfi.production_status, 'planning') AS production_status,
    COALESCE(dfi.reported_deviation_percent, 0::numeric) AS reported_deviation_percent,
    COALESCE(dfi.deviation_sample_size, 0) AS deviation_sample_size,
    dfi.linked_batch_id,
    COALESCE(s.name, 'Unknown') AS study_name,
    COALESCE(s.code, '') AS study_code,
    COALESCE(p.name, 'Unknown') AS product_name
  FROM public.distribution_forecast_items dfi
  JOIN public.studies s ON s.id = dfi.study_id
  JOIN public.products p ON p.id = dfi.product_id
  WHERE dfi.forecast_month = v_month_start
    AND (p_study_id IS NULL OR dfi.study_id = p_study_id)
  ORDER BY p.name, s.name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_distribution_forecasts_admin(p_month date, p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_distribution_forecasts_admin(p_month date, p_study_id uuid) TO authenticated;
