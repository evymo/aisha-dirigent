-- Function: public.get_product_dose_options
-- Arguments: p_product_id uuid
-- Description: Get allowed dose units and their config for a product
-- Security: SECURITY DEFINER - accessible by anon and authenticated

CREATE OR REPLACE FUNCTION public.get_product_dose_options(p_product_id uuid)
RETURNS TABLE (
  unit_code text,
  unit_name_key text,
  unit_abbr_key text,
  is_default boolean,
  default_amount numeric,
  min_amount numeric,
  max_amount numeric,
  step_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    du.code,
    du.name_key,
    du.abbreviation_key,
    pdu.is_default,
    pdu.default_amount,
    pdu.min_amount,
    pdu.max_amount,
    pdu.step_amount
  FROM product_dose_units pdu
  JOIN dose_units du ON du.code = pdu.dose_unit_code
  WHERE pdu.product_id = p_product_id
    AND du.is_active = true
  ORDER BY pdu.is_default DESC, du.sort_order;
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_dose_options(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_dose_options(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_product_dose_options(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_product_dose_options(uuid) IS 'Get allowed dose units and their config for a product (for mobile/web combo selection)';
