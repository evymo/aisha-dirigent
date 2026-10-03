-- Function: get_community_products
-- Purpose: Returns public community products ordered by popularity
-- Access: authenticated
-- Security: SECURITY DEFINER
-- Created: 2026-02-07

CREATE OR REPLACE FUNCTION public.get_community_products(
  p_locale TEXT DEFAULT 'en',
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  category TEXT,
  default_dose_amount NUMERIC,
  default_dose_unit TEXT,
  default_doses_per_day INTEGER,
  default_dose_timing TEXT[],
  usage_count INTEGER,
  created_by UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Community products from member_products where is_public = true
  RETURN QUERY
  SELECT
    ms.id,
    ms.name,
    COALESCE(ms.description, '') AS description,
    ms.category,
    ms.default_dose_amount,
    ms.default_dose_unit,
    ms.default_doses_per_day,
    ms.default_dose_timing,
    ms.usage_count,
    ms.created_by
  FROM member_products ms
  WHERE ms.is_public = true
  ORDER BY ms.usage_count DESC, ms.name ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_community_products(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_community_products(text, integer) TO authenticated;

COMMENT ON FUNCTION public.get_community_products(text, integer) IS 'Returns public community products ordered by popularity.';
