-- Function: public.create_order_with_items_audited
-- Arguments: p_total numeric, p_shipping_address jsonb, p_billing_address jsonb, p_product_id text, p_quantity integer, p_items jsonb, p_shipping_method text, p_packeta_branch_id integer, p_currency text, p_voucher_code text, p_payment_method text, p_carrier_id integer, p_carrier_name text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:07+01:00

CREATE OR REPLACE FUNCTION public.create_order_with_items_audited(
  p_total numeric,
  p_shipping_address jsonb,
  p_billing_address jsonb,
  p_product_id text DEFAULT NULL::text,
  p_quantity integer DEFAULT 1,
  p_items jsonb DEFAULT NULL::jsonb,
  p_shipping_method text DEFAULT NULL::text,
  p_packeta_branch_id integer DEFAULT NULL::integer,
  p_currency text DEFAULT public.commerce_base_currency(),
  p_voucher_code text DEFAULT NULL::text,
  p_payment_method text DEFAULT 'bank_transfer'::text,
  p_carrier_id integer DEFAULT NULL::integer,
  p_carrier_name text DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_order_id UUID;
  v_item JSONB;
  v_product_price_base NUMERIC;
  v_item_price NUMERIC;
  v_subtotal NUMERIC := 0;
  v_shipping NUMERIC := 0;
  v_currency TEXT := upper(COALESCE(p_currency, public.commerce_base_currency()));
  v_base_currency TEXT := public.commerce_base_currency();
  v_country TEXT := NULL;
  v_voucher_id UUID;
  v_voucher_product_id UUID;
  v_voucher_discount NUMERIC := 0;
  v_voucher_applied BOOLEAN := false;
BEGIN
  -- Authorization check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Resolve base currency for product prices (system-configurable)
  SELECT COALESCE(value #>> '{}', public.commerce_base_currency())
  INTO v_base_currency
  FROM public.system_config
  WHERE key = 'commerce_base_currency'
  LIMIT 1;

  v_base_currency := upper(COALESCE(v_base_currency, public.commerce_base_currency()));
  v_country := COALESCE(p_shipping_address->>'country', 'CZ');
  v_shipping := COALESCE(public.get_shipping_cost(p_shipping_method, v_country, v_currency), 0);

  -- Validate voucher up front if provided.
  IF p_voucher_code IS NOT NULL AND length(p_voucher_code) > 0 THEN
    SELECT id, product_id
    INTO v_voucher_id, v_voucher_product_id
    FROM public.product_vouchers
    WHERE code = upper(btrim(p_voucher_code))
      AND status = 'active'
      AND (user_id IS NULL OR user_id = v_user_id)
      AND (expires_at IS NULL OR expires_at > now())
    FOR UPDATE;

    IF v_voucher_id IS NULL THEN
      RAISE EXCEPTION 'Invalid or expired voucher code' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Create order with shipping method and packeta branch (totals set after items)
  INSERT INTO orders (
    user_id, 
    total,
    subtotal,
    shipping,
    currency,
    shipping_address, 
    billing_address, 
    status,
    shipping_method,
    packeta_branch_id,
    carrier_id,
    carrier_name
  )
  VALUES (
    v_user_id, 
    0,
    0,
    v_shipping,
    v_currency,
    p_shipping_address, 
    p_billing_address, 
    'pending',
    p_shipping_method,
    p_packeta_branch_id,
    p_carrier_id,
    p_carrier_name
  )
  RETURNING id INTO v_order_id;

  -- Insert order items from array
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      SELECT price INTO v_product_price_base 
      FROM products 
      WHERE id = (v_item->>'product_id')::UUID;

      v_item_price := COALESCE(
        public.convert_currency_amount(v_product_price_base, v_base_currency, v_currency),
        v_product_price_base,
        0
      );

      -- Apply voucher discount once if the matching product is in cart.
      IF v_voucher_id IS NOT NULL
         AND (v_item->>'product_id')::UUID = v_voucher_product_id
         AND NOT v_voucher_applied THEN
        v_voucher_discount := v_item_price;
        v_voucher_applied := true;
      END IF;

      v_subtotal := v_subtotal + (v_item_price * (v_item->>'quantity')::INTEGER);

      INSERT INTO order_items (order_id, product_id, quantity, price, price_at_purchase)
      VALUES (
        v_order_id, 
        (v_item->>'product_id')::UUID, 
        (v_item->>'quantity')::INTEGER, 
        COALESCE(v_product_price_base, 0),
        COALESCE(v_item_price, 0)
      );
    END LOOP;
  -- Or insert single item
  ELSIF p_product_id IS NOT NULL THEN
    SELECT price INTO v_product_price_base 
    FROM products 
    WHERE id = p_product_id::UUID;

    v_item_price := COALESCE(
      public.convert_currency_amount(v_product_price_base, v_base_currency, v_currency),
      v_product_price_base,
      0
    );

    IF v_voucher_id IS NOT NULL AND p_product_id::UUID = v_voucher_product_id THEN
      v_voucher_discount := v_item_price;
      v_voucher_applied := true;
    END IF;

    v_subtotal := v_item_price * p_quantity;
    
    INSERT INTO order_items (order_id, product_id, quantity, price, price_at_purchase)
    VALUES (
      v_order_id, 
      p_product_id::UUID, 
      p_quantity, 
      COALESCE(v_product_price_base, 0),
      COALESCE(v_item_price, 0)
    );
  END IF;

  IF p_voucher_code IS NOT NULL AND NOT v_voucher_applied THEN
    RAISE EXCEPTION 'Voucher valid but applicable product not found in cart' USING ERRCODE = 'P0002';
  END IF;

  IF v_voucher_applied THEN
    UPDATE public.product_vouchers
    SET
      status = 'used',
      used_at = now(),
      user_id = COALESCE(user_id, v_user_id),
      metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{order_id}', to_jsonb(v_order_id)),
      updated_at = now()
    WHERE id = v_voucher_id;
  END IF;

  -- Update totals (server-authoritative)
  UPDATE orders
  SET
    subtotal = v_subtotal,
    total = GREATEST(0, v_subtotal + v_shipping - v_voucher_discount),
    updated_at = NOW()
  WHERE id = v_order_id;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'commerce'::journal_area,
      p_details := jsonb_build_object(
      'total', GREATEST(0, v_subtotal + v_shipping - v_voucher_discount),
      'subtotal', v_subtotal,
      'discount', v_voucher_discount,
      'voucher_code', p_voucher_code,
      'shipping_method', p_shipping_method,
      'has_packeta', p_packeta_branch_id IS NOT NULL,
      'carrier_id', p_carrier_id,
      'carrier_name', p_carrier_name,
      'currency', v_currency
    ),
      p_entity_id := v_order_id::TEXT,
      p_entity_type := 'order',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User created order' || CASE WHEN v_voucher_applied THEN ' with voucher' ELSE '' END,
      p_tags := ARRAY['order', 'commerce'],
      p_user_id := v_user_id
  );

  -- Clear cart
  DELETE FROM cart_items WHERE user_id = v_user_id;

  RETURN v_order_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_order_with_items_audited(p_total numeric, p_shipping_address jsonb, p_billing_address jsonb, p_product_id text, p_quantity integer, p_items jsonb, p_shipping_method text, p_packeta_branch_id integer, p_currency text, p_voucher_code text, p_payment_method text, p_carrier_id integer, p_carrier_name text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_order_with_items_audited(p_total numeric, p_shipping_address jsonb, p_billing_address jsonb, p_product_id text, p_quantity integer, p_items jsonb, p_shipping_method text, p_packeta_branch_id integer, p_currency text, p_voucher_code text, p_payment_method text, p_carrier_id integer, p_carrier_name text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_items_audited(p_total numeric, p_shipping_address jsonb, p_billing_address jsonb, p_product_id text, p_quantity integer, p_items jsonb, p_shipping_method text, p_packeta_branch_id integer, p_currency text, p_voucher_code text, p_payment_method text, p_carrier_id integer, p_carrier_name text) TO authenticated;
