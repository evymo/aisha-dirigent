-- Function: public.redeem_product_voucher
-- Validates and redeems one voucher code for the authenticated user.

CREATE OR REPLACE FUNCTION public.redeem_product_voucher(
  p_code text,
  p_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_voucher record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'Voucher code is required' USING ERRCODE = '22023';
  END IF;

  SELECT
    pv.id,
    pv.expires_at,
    pv.status,
    pv.user_id
  INTO v_voucher
  FROM public.product_vouchers pv
  WHERE pv.code = upper(btrim(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid voucher code' USING ERRCODE = 'P0001';
  END IF;

  IF v_voucher.status <> 'active' THEN
    RAISE EXCEPTION 'Voucher is not active' USING ERRCODE = 'P0001';
  END IF;

  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at <= now() THEN
    UPDATE public.product_vouchers
    SET
      status = 'expired',
      updated_at = now()
    WHERE id = v_voucher.id;

    RAISE EXCEPTION 'Voucher has expired' USING ERRCODE = 'P0001';
  END IF;

  IF v_voucher.user_id IS NOT NULL AND v_voucher.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Voucher does not belong to this user' USING ERRCODE = '42501';
  END IF;

  UPDATE public.product_vouchers
  SET
    status = 'used',
    used_at = now(),
    user_id = COALESCE(user_id, v_user_id),
    metadata = CASE
      WHEN p_order_id IS NULL THEN COALESCE(metadata, '{}'::jsonb)
      ELSE jsonb_set(COALESCE(metadata, '{}'::jsonb), '{order_id}', to_jsonb(p_order_id), true)
    END,
    updated_at = now()
  WHERE id = v_voucher.id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.redeem_product_voucher(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_product_voucher(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.redeem_product_voucher(text, uuid) TO authenticated;
