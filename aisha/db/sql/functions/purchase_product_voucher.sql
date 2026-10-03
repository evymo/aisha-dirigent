-- Function: public.purchase_product_voucher
-- Deducts tokens from wallet and creates an active voucher for a product.

CREATE OR REPLACE FUNCTION public.purchase_product_voucher(
  p_product_id uuid,
  p_point_cost int4,
  p_token_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_balance numeric := 0;
  v_voucher_id uuid;
  v_voucher_code text;
  v_attempt int4;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product is required' USING ERRCODE = '22023';
  END IF;

  IF p_point_cost IS NULL OR p_point_cost <= 0 THEN
    RAISE EXCEPTION 'Point cost must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF p_token_type NOT IN ('governance', 'impact', 'data') THEN
    RAISE EXCEPTION 'Invalid token type' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0001';
  END IF;

  -- Lock wallet row for consistent balance check.
  SELECT
    CASE
      WHEN p_token_type = 'governance' THEN governance_tokens
      WHEN p_token_type = 'impact' THEN impact_tokens
      WHEN p_token_type = 'data' THEN data_tokens
      ELSE 0
    END
  INTO v_current_balance
  FROM public.user_wallets
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.user_wallets (
      user_id,
      governance_tokens,
      impact_tokens,
      data_tokens,
      created_at,
      updated_at
    )
    SELECT
      v_user_id,
      COALESCE(SUM(CASE WHEN token_type = 'governance' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN token_type = 'impact' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN token_type = 'data' THEN amount ELSE 0 END), 0),
      now(),
      now()
    FROM public.token_transactions
    WHERE user_id = v_user_id
    ON CONFLICT (user_id) DO NOTHING;

    SELECT
      CASE
        WHEN p_token_type = 'governance' THEN governance_tokens
        WHEN p_token_type = 'impact' THEN impact_tokens
        WHEN p_token_type = 'data' THEN data_tokens
        ELSE 0
      END
    INTO v_current_balance
    FROM public.user_wallets
    WHERE user_id = v_user_id
    FOR UPDATE;
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);

  IF v_current_balance < p_point_cost THEN
    RAISE EXCEPTION 'Insufficient % tokens', p_token_type USING ERRCODE = 'P0001';
  END IF;

  FOR v_attempt IN 1..10 LOOP
    v_voucher_code := upper(substring(md5(gen_random_uuid()::text || clock_timestamp()::text) FROM 1 FOR 8));

    BEGIN
      INSERT INTO public.product_vouchers (
        code,
        product_id,
        user_id,
        status,
        points_cost,
        expires_at
      )
      VALUES (
        v_voucher_code,
        p_product_id,
        v_user_id,
        'active',
        p_point_cost,
        now() + interval '1 year'
      )
      RETURNING id INTO v_voucher_id;

      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        -- Retry with a new generated code.
        NULL;
    END;
  END LOOP;

  IF v_voucher_id IS NULL THEN
    RAISE EXCEPTION 'Failed to generate voucher code' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.token_transactions (
    user_id,
    amount,
    token_type,
    transaction_type,
    description,
    reference_id
  )
  VALUES (
    v_user_id,
    -p_point_cost,
    p_token_type,
    'spent',
    'Purchased voucher ' || v_voucher_code,
    v_voucher_id
  );

  RETURN v_voucher_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_product_voucher(uuid, int4, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purchase_product_voucher(uuid, int4, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.purchase_product_voucher(uuid, int4, text) TO authenticated;
