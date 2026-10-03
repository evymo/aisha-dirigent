-- Function: get_biomarker_reference_ranges_localized
-- Purpose: Returns biomarker reference ranges with localized name and description
-- Created: 2026-02-03

CREATE OR REPLACE FUNCTION public.get_biomarker_reference_ranges_localized(
  p_locale TEXT DEFAULT 'en',
  p_category TEXT DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_locale TEXT;
BEGIN
  -- Validate locale (supported: cs, de, en, fr, ru, th)
  v_locale := CASE
    WHEN p_locale IN ('cs', 'de', 'en', 'fr', 'ru', 'th') THEN p_locale
    ELSE 'en'
  END;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', brr.id,
      'biomarker_key', brr.biomarker_key,
      'name', public.get_translation_value_with_fallback(
        brr.name_key, 'biomarkers', v_locale, 'en', NULL
      ),
      'description', public.get_translation_value_with_fallback(
        brr.description_key, 'biomarkers', v_locale, 'en', NULL
      ),
      'category', brr.category,
      'unit', brr.unit,
      'min_value', brr.min_value,
      'max_value', brr.max_value,
      'optimal_min', brr.optimal_min,
      'optimal_max', brr.optimal_max,
      'critical_low', brr.critical_low,
      'critical_high', brr.critical_high,
      'is_active', brr.is_active
    ) ORDER BY brr.category, brr.biomarker_key
  )
  INTO v_result
  FROM biomarker_reference_ranges brr
  WHERE brr.is_active = true
    AND (p_category IS NULL OR brr.category = p_category);

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_biomarker_reference_ranges_localized(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_biomarker_reference_ranges_localized(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_biomarker_reference_ranges_localized(TEXT, TEXT) TO anon;
