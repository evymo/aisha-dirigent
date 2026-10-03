-- Function: get_product_catalog
-- Purpose: Returns localized product catalog (official entries)
-- Access: authenticated + anon (public catalog)
-- Security: SECURITY DEFINER (anon needs access)

CREATE OR REPLACE FUNCTION public.get_product_catalog(
  p_locale TEXT DEFAULT 'en',
  p_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  code TEXT,
  category TEXT,
  icon TEXT,
  color TEXT,
  default_dose_amount NUMERIC,
  default_dose_unit TEXT,
  default_doses_per_day INTEGER,
  default_dose_timing TEXT[],
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
    sc.id,
    sc.code,
    sc.category,
    sc.icon,
    sc.color,
    sc.default_dose_amount,
    sc.default_dose_unit,
    sc.default_doses_per_day,
    sc.default_dose_timing,
    sc.sort_order,
    sc.is_active,
    COALESCE(
      (SELECT t.value FROM translations t WHERE t.namespace = 'product_catalog' AND t.key = sc.code || '.name' AND t.locale = p_locale),
      (SELECT t.value FROM translations t WHERE t.namespace = 'product_catalog' AND t.key = sc.code || '.name' AND t.locale = 'en'),
      sc.code
    ) AS name,
    COALESCE(
      (SELECT t.value FROM translations t WHERE t.namespace = 'product_catalog' AND t.key = sc.code || '.description' AND t.locale = p_locale),
      (SELECT t.value FROM translations t WHERE t.namespace = 'product_catalog' AND t.key = sc.code || '.description' AND t.locale = 'en'),
      ''
    ) AS description
  FROM product_catalog sc
  WHERE sc.is_active = true
    AND (p_category IS NULL OR sc.category = p_category)
  ORDER BY sc.sort_order, sc.code;
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_catalog(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_catalog(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_product_catalog(text, text) TO authenticated;

COMMENT ON FUNCTION public.get_product_catalog(text, text) IS 'Returns localized product catalog. Translations from translations table, fallback to EN then code.';
