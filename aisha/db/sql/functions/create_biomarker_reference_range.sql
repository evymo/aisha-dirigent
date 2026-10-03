-- Function: public.create_biomarker_reference_range
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:51.878Z

CREATE OR REPLACE FUNCTION public.create_biomarker_reference_range(p_biomarker_key text, p_category text, p_critical_high numeric DEFAULT NULL::numeric, p_critical_low numeric DEFAULT NULL::numeric, p_description_key text DEFAULT NULL::text, p_is_active boolean DEFAULT true, p_max_value numeric DEFAULT NULL::numeric, p_min_value numeric DEFAULT NULL::numeric, p_name_key text DEFAULT NULL::text, p_optimal_max numeric DEFAULT NULL::numeric, p_optimal_min numeric DEFAULT NULL::numeric, p_unit text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id UUID;
    v_name_key text;
    v_description_key text;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;

    v_name_key := COALESCE(p_name_key, 'biomarker.' || p_biomarker_key || '.name');
    v_description_key := COALESCE(p_description_key, 'biomarker.' || p_biomarker_key || '.description');

    INSERT INTO public.biomarker_reference_ranges (
        biomarker_key, name_key, description_key, unit, category,
        min_value, max_value, optimal_min, optimal_max,
        critical_low, critical_high, is_active
    ) VALUES (
        p_biomarker_key, v_name_key, v_description_key, p_unit, p_category,
        p_min_value, p_max_value, p_optimal_min, p_optimal_max,
        p_critical_low, p_critical_high, p_is_active
    ) RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_biomarker_reference_range(text, text, numeric, numeric, text, boolean, numeric, numeric, text, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_biomarker_reference_range(text, text, numeric, numeric, text, boolean, numeric, numeric, text, numeric, numeric, text) TO authenticated;

