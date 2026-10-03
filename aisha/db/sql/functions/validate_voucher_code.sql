-- Function: public.validate_voucher_code
-- Validates a voucher code without redeeming. Returns voucher details if valid.

CREATE OR REPLACE FUNCTION public.validate_voucher_code(
  p_code text
)
RETURNS TABLE (
  id uuid,
  code text,
  product_id uuid,
  status text,
  points_cost int4,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_normalized_code text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'Voucher code is required' USING ERRCODE = '22023';
  END IF;

  v_normalized_code := upper(btrim(p_code));

  RETURN QUERY
  SELECT
    pv.id,
    pv.code,
    pv.product_id,
    pv.status,
    pv.points_cost,
    pv.expires_at
  FROM public.product_vouchers pv
  WHERE pv.code = v_normalized_code
    AND pv.status = 'active'
    AND (pv.user_id IS NULL OR pv.user_id = v_user_id)
    AND (pv.expires_at IS NULL OR pv.expires_at > now());
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_voucher_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_voucher_code(text) TO authenticated;
