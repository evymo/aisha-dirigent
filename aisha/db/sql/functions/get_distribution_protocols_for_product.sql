-- Function: get_distribution_protocols_for_product
-- Returns available distribution protocols for a specific product
-- Security: Public read (no sensitive data)
-- Created: 2026-01-17

CREATE OR REPLACE FUNCTION public.get_distribution_protocols_for_product(
  p_product_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  dose_amount numeric,
  dose_unit text,
  doses_per_day int,
  dose_timing text[],
  arm_code text,
  study_id uuid,
  study_name text,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dp.id,
    dp.name,
    dp.description,
    dp.dose_amount,
    dp.dose_unit,
    dp.doses_per_day,
    dp.dose_timing,
    dp.arm_code,
    dp.study_id,
    COALESCE(s.name, '') as study_name,
    dp.is_active
  FROM distribution_protocols dp
  LEFT JOIN studies s ON s.id = dp.study_id
  WHERE dp.product_id = p_product_id 
    AND dp.is_active = true
  ORDER BY dp.name;
END;
$$;

-- Permissions - public access since this is just protocol info, no sensitive data
REVOKE ALL ON FUNCTION public.get_distribution_protocols_for_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_distribution_protocols_for_product(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_distribution_protocols_for_product(uuid) TO anon;

COMMENT ON FUNCTION public.get_distribution_protocols_for_product(uuid) IS 
'Returns available distribution protocols for a specific product. No sensitive data, public access.';
