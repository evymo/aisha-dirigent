-- Function: public.update_distribution_forecast
-- Arguments: p_id uuid, p_production_status text, p_expected_demand integer, p_production_capacity integer, p_inventory_level integer, p_notes text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:16+01:00

CREATE OR REPLACE FUNCTION public.update_distribution_forecast(p_id uuid, p_production_status text DEFAULT NULL::text, p_expected_demand integer DEFAULT NULL::integer, p_production_capacity integer DEFAULT NULL::integer, p_inventory_level integer DEFAULT NULL::integer, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  UPDATE distribution_forecasts SET
    production_status = COALESCE(p_production_status, production_status),
    expected_demand = COALESCE(p_expected_demand, expected_demand),
    production_capacity = COALESCE(p_production_capacity, production_capacity),
    inventory_level = COALESCE(p_inventory_level, inventory_level),
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_distribution_forecast(p_id uuid, p_production_status text, p_expected_demand integer, p_production_capacity integer, p_inventory_level integer, p_notes text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_distribution_forecast(p_id uuid, p_production_status text, p_expected_demand integer, p_production_capacity integer, p_inventory_level integer, p_notes text) TO authenticated;
