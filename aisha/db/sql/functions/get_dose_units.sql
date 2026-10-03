-- Function: public.get_dose_units
-- Description: Get all active dose units for reference
-- Security: SECURITY DEFINER - accessible by anon and authenticated

CREATE OR REPLACE FUNCTION public.get_dose_units()
RETURNS TABLE (
  code text,
  name_key text,
  abbreviation_key text,
  category text,
  sort_order integer
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
    du.category,
    du.sort_order
  FROM dose_units du
  WHERE du.is_active = true
  ORDER BY du.sort_order;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dose_units() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dose_units() TO anon;
GRANT EXECUTE ON FUNCTION public.get_dose_units() TO authenticated;

COMMENT ON FUNCTION public.get_dose_units() IS 'Get all active dose units for reference/admin';
