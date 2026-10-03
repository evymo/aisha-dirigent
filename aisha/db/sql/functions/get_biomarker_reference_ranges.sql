-- Function: public.get_biomarker_reference_ranges
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:53.356Z

CREATE OR REPLACE FUNCTION public.get_biomarker_reference_ranges(p_active_only boolean DEFAULT true)
 RETURNS TABLE(id uuid, biomarker_key text, name_key text, unit text, min_value numeric, max_value numeric, optimal_min numeric, optimal_max numeric, critical_low numeric, critical_high numeric, category text, description_key text, is_active boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    b.id,
    b.biomarker_key,
    b.name_key,
    b.unit,
    b.min_value,
    b.max_value,
    b.optimal_min,
    b.optimal_max,
    b.critical_low,
    b.critical_high,
    b.category,
    b.description_key,
    b.is_active,
    b.created_at,
    b.updated_at
  FROM public.biomarker_reference_ranges b
  WHERE (NOT p_active_only OR b.is_active = true)
  ORDER BY b.category, b.biomarker_key;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_biomarker_reference_ranges(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_biomarker_reference_ranges(boolean) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_biomarker_reference_ranges(boolean) TO authenticated;

