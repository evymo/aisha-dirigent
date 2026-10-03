-- Function: public.update_biomarker_reference_range
-- Arguments: p_id uuid, p_min_value numeric, p_max_value numeric, p_optimal_min numeric, p_optimal_max numeric, p_critical_low numeric, p_critical_high numeric, p_is_active boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:15+01:00

CREATE OR REPLACE FUNCTION public.update_biomarker_reference_range(p_id uuid, p_min_value numeric DEFAULT NULL::numeric, p_max_value numeric DEFAULT NULL::numeric, p_optimal_min numeric DEFAULT NULL::numeric, p_optimal_max numeric DEFAULT NULL::numeric, p_critical_low numeric DEFAULT NULL::numeric, p_critical_high numeric DEFAULT NULL::numeric, p_is_active boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;

    UPDATE public.biomarker_reference_ranges SET
        min_value = COALESCE(p_min_value, min_value),
        max_value = COALESCE(p_max_value, max_value),
        optimal_min = COALESCE(p_optimal_min, optimal_min),
        optimal_max = COALESCE(p_optimal_max, optimal_max),
        critical_low = COALESCE(p_critical_low, critical_low),
        critical_high = COALESCE(p_critical_high, critical_high),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = NOW()
    WHERE id = p_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_biomarker_reference_range(p_id uuid, p_min_value numeric, p_max_value numeric, p_optimal_min numeric, p_optimal_max numeric, p_critical_low numeric, p_critical_high numeric, p_is_active boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_biomarker_reference_range(p_id uuid, p_min_value numeric, p_max_value numeric, p_optimal_min numeric, p_optimal_max numeric, p_critical_low numeric, p_critical_high numeric, p_is_active boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_biomarker_reference_range(p_id uuid, p_min_value numeric, p_max_value numeric, p_optimal_min numeric, p_optimal_max numeric, p_critical_low numeric, p_critical_high numeric, p_is_active boolean) TO authenticated;
