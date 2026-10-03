-- Function: get_symptom_catalog
-- Purpose: Returns localized symptom catalog (official entries)
-- Access: authenticated + anon (public catalog)
-- Security: SECURITY DEFINER (anon needs access)

CREATE OR REPLACE FUNCTION public.get_symptom_catalog(
  p_locale TEXT DEFAULT 'en',
  p_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  code TEXT,
  category TEXT,
  icon TEXT,
  color TEXT,
  default_severity_scale INTEGER,
  sort_order INTEGER,
  is_active BOOLEAN,
  name TEXT,
  description TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    syc.id,
    syc.code,
    syc.category,
    syc.icon,
    syc.color,
    syc.default_severity_scale,
    syc.sort_order,
    syc.is_active,
    COALESCE(
      (SELECT t.value FROM translations t WHERE t.namespace = 'symptom_catalog' AND t.key = syc.code || '.name' AND t.locale = p_locale),
      (SELECT t.value FROM translations t WHERE t.namespace = 'symptom_catalog' AND t.key = syc.code || '.name' AND t.locale = 'en'),
      syc.code
    ) AS name,
    COALESCE(
      (SELECT t.value FROM translations t WHERE t.namespace = 'symptom_catalog' AND t.key = syc.code || '.description' AND t.locale = p_locale),
      (SELECT t.value FROM translations t WHERE t.namespace = 'symptom_catalog' AND t.key = syc.code || '.description' AND t.locale = 'en'),
      ''
    ) AS description
  FROM symptom_catalog syc
  WHERE syc.is_active = true
    AND (p_category IS NULL OR syc.category = p_category)
  ORDER BY syc.sort_order, syc.code;
END;
$$;

REVOKE ALL ON FUNCTION public.get_symptom_catalog(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_symptom_catalog(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_symptom_catalog(text, text) TO authenticated;

COMMENT ON FUNCTION public.get_symptom_catalog(text, text) IS 'Returns localized symptom catalog. Translations from translations table, fallback to EN then code.';
