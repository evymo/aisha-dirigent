-- create_manual_voucher_admin: Admin creates voucher manually (promo, compensation)
CREATE OR REPLACE FUNCTION public.create_manual_voucher_admin(
  p_product_id uuid,
  p_reason text DEFAULT 'manual',
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  code text,
  id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_voucher_id uuid;
  v_voucher_code text;
  v_attempt int4;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE products.id = p_product_id) THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0001';
  END IF;

  -- Generate unique 8-char code
  FOR v_attempt IN 1..10 LOOP
    v_voucher_code := upper(substring(md5(gen_random_uuid()::text || clock_timestamp()::text) FROM 1 FOR 8));

    BEGIN
      INSERT INTO public.product_vouchers (
        code,
        product_id,
        user_id,
        status,
        points_cost,
        expires_at,
        metadata
      )
      VALUES (
        v_voucher_code,
        p_product_id,
        p_user_id,  -- NULL means unassigned (general promo)
        'active',
        0,  -- no token cost for manual vouchers
        now() + interval '1 year',
        jsonb_build_object(
          'created_by', v_admin_id,
          'reason', p_reason,
          'type', 'manual'
        )
      )
      RETURNING product_vouchers.id INTO v_voucher_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  IF v_voucher_id IS NULL THEN
    RAISE EXCEPTION 'Failed to generate voucher code' USING ERRCODE = 'P0001';
  END IF;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_admin_id, 'VOUCHER_MANUAL_CREATE', jsonb_build_object(
    'area', 'admin',
    'severity', 'info',
    'voucher_id', v_voucher_id,
    'product_id', p_product_id,
    'target_user_id', p_user_id,
    'reason', p_reason
  ));

  RETURN QUERY SELECT v_voucher_code, v_voucher_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_manual_voucher_admin(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_manual_voucher_admin(uuid, text, uuid) TO authenticated;
