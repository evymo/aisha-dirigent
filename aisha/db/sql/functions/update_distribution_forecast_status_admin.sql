-- Function: public.update_distribution_forecast_status_admin
-- Arguments: p_id uuid, p_production_status text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:17+01:00

CREATE OR REPLACE FUNCTION public.update_distribution_forecast_status_admin(p_id uuid, p_production_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff access required';
  END IF;

  UPDATE public.distribution_forecast_items
  SET 
    production_status = p_production_status,
    updated_at = now()
  WHERE id = p_id;

  INSERT INTO audit_journal (
    user_id, action_type, entity_type, entity_id, area, severity, summary, details
  ) VALUES (
    auth.uid(), 'update'::journal_action_type, 'distribution_forecast_items', p_id::text,
    'production'::journal_area, 'info'::journal_severity,
    'Admin updated distribution forecast status',
    jsonb_build_object('forecast_id', p_id, 'new_status', p_production_status)
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_distribution_forecast_status_admin(p_id uuid, p_production_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_distribution_forecast_status_admin(p_id uuid, p_production_status text) TO authenticated;
