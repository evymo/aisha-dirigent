-- Function: public.edge_orders
-- Purpose: Edge-safe order reads and writes with ownership validation.
-- Security: SECURITY DEFINER with auth.uid() ownership checks per action.
--           service_role bypasses ownership (for edge functions / webhooks).

CREATE OR REPLACE FUNCTION public.edge_orders(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_row jsonb;
  v_user_id uuid;
  v_caller_id uuid;
  v_is_service_role boolean;
BEGIN
  -- Determine caller identity
  v_caller_id := auth.uid();
  v_is_service_role := (public.get_jwt_role() = 'service_role');

  -- ── get_checkout_context ───────────────────────────────────────────────
  IF p_action = 'get_checkout_context' THEN
    v_order_id := NULLIF(p_payload ->> 'order_id', '')::uuid;
    v_user_id := NULLIF(p_payload ->> 'user_id', '')::uuid;

    IF v_order_id IS NULL OR v_user_id IS NULL THEN
      RAISE EXCEPTION 'Missing required payload fields';
    END IF;

    -- Ownership: caller must match requested user_id (unless service_role)
    IF NOT v_is_service_role AND v_caller_id IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'Unauthorized: caller does not own this resource';
    END IF;

    SELECT jsonb_build_object(
      'currency', o.currency,
      'id', o.id,
      'order_items', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', oi.id,
              'price_at_purchase', oi.price_at_purchase,
              'product', (
                SELECT jsonb_build_array(
                  jsonb_build_object(
                    'description', p.description,
                    'name', p.name
                  )
                )
                FROM public.products p
                WHERE p.id = oi.product_id
                LIMIT 1
              ),
              'product_id', oi.product_id,
              'quantity', oi.quantity
            )
          )
          FROM public.order_items oi
          WHERE oi.order_id = o.id
        ),
        '[]'::jsonb
      ),
      'shipping', o.shipping,
      'shipping_address', o.shipping_address,
      'status', o.status,
      'total', o.total,
      'user_id', o.user_id
    )
    INTO v_row
    FROM public.orders o
    WHERE o.id = v_order_id
      AND o.user_id = v_user_id
    LIMIT 1;

    RETURN jsonb_build_object('row', v_row);
  END IF;

  -- ── get_order_id_by_payment_intent ─────────────────────────────────────
  -- Only service_role (Stripe webhook edge functions) should look up by payment intent
  IF p_action = 'get_order_id_by_payment_intent' THEN
    IF NOT v_is_service_role THEN
      RAISE EXCEPTION 'Unauthorized: service_role required for payment intent lookup';
    END IF;

    SELECT jsonb_build_object('order_id', o.id)
    INTO v_row
    FROM public.orders o
    WHERE o.stripe_payment_intent_id = NULLIF(p_payload ->> 'stripe_payment_intent_id', '')
    ORDER BY o.created_at DESC
    LIMIT 1;

    RETURN COALESCE(v_row, jsonb_build_object('order_id', NULL));
  END IF;

  -- ── get_packeta_context ────────────────────────────────────────────────
  IF p_action = 'get_packeta_context' THEN
    v_order_id := NULLIF(p_payload ->> 'order_id', '')::uuid;
    IF v_order_id IS NULL THEN
      RAISE EXCEPTION 'Missing order_id';
    END IF;

    -- Ownership check
    IF NOT v_is_service_role THEN
      PERFORM 1 FROM public.orders WHERE id = v_order_id AND user_id = v_caller_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Unauthorized: caller does not own this order';
      END IF;
    END IF;

    SELECT jsonb_build_object(
      'order', jsonb_build_object(
        'id', o.id,
        'packeta_branch_id', o.packeta_branch_id,
        'packeta_packet_id', o.packeta_packet_id,
        'shipping_address', o.shipping_address,
        'status', o.status,
        'total', o.total,
        'user_id', o.user_id
      ),
      'order_items',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'product_id', oi.product_id,
              'quantity', oi.quantity
            )
          )
          FROM public.order_items oi
          WHERE oi.order_id = o.id
        ),
        '[]'::jsonb
      )
    )
    INTO v_row
    FROM public.orders o
    WHERE o.id = v_order_id
    LIMIT 1;

    RETURN jsonb_build_object('row', v_row);
  END IF;

  -- ── update_order ───────────────────────────────────────────────────────
  -- Only service_role can update orders (edge functions handling webhooks/fulfillment)
  IF p_action = 'update_order' THEN
    IF NOT v_is_service_role THEN
      RAISE EXCEPTION 'Unauthorized: service_role required for order updates';
    END IF;

    v_order_id := NULLIF(p_payload ->> 'order_id', '')::uuid;
    IF v_order_id IS NULL THEN
      RAISE EXCEPTION 'Missing order_id';
    END IF;

    UPDATE public.orders
    SET
      packeta_barcode = CASE WHEN p_payload ? 'packeta_barcode' THEN NULLIF(p_payload ->> 'packeta_barcode', '') ELSE packeta_barcode END,
      packeta_branch_id = CASE WHEN p_payload ? 'packeta_branch_id' THEN NULLIF(p_payload ->> 'packeta_branch_id', '')::integer ELSE packeta_branch_id END,
      packeta_packet_id = CASE WHEN p_payload ? 'packeta_packet_id' THEN NULLIF(p_payload ->> 'packeta_packet_id', '') ELSE packeta_packet_id END,
      status = COALESCE(NULLIF(p_payload ->> 'status', ''), status),
      payment_status = CASE WHEN p_payload ? 'payment_status' THEN NULLIF(p_payload ->> 'payment_status', '') ELSE payment_status END,
      stripe_payment_intent_id = CASE WHEN p_payload ? 'stripe_payment_intent_id' THEN NULLIF(p_payload ->> 'stripe_payment_intent_id', '') ELSE stripe_payment_intent_id END,
      stripe_session_id = CASE WHEN p_payload ? 'stripe_session_id' THEN NULLIF(p_payload ->> 'stripe_session_id', '') ELSE stripe_session_id END,
      tracking_url = CASE WHEN p_payload ? 'tracking_url' THEN NULLIF(p_payload ->> 'tracking_url', '') ELSE tracking_url END,
      invoice_number = CASE WHEN p_payload ? 'invoice_number' THEN NULLIF(p_payload ->> 'invoice_number', '') ELSE invoice_number END,
      invoice_pdf_path = CASE WHEN p_payload ? 'invoice_pdf_path' THEN NULLIF(p_payload ->> 'invoice_pdf_path', '') ELSE invoice_pdf_path END,
      invoice_generated_at = CASE WHEN p_payload ? 'invoice_generated_at' THEN (NULLIF(p_payload ->> 'invoice_generated_at', ''))::timestamptz ELSE invoice_generated_at END,
      updated_at = now()
    WHERE id = v_order_id;

    RETURN jsonb_build_object('ok', true, 'updated', FOUND);
  END IF;

  -- ── get_order_full ─────────────────────────────────────────────────────
  -- Service_role or order owner can read full order details
  IF p_action = 'get_order_full' THEN
    v_order_id := NULLIF(p_payload ->> 'order_id', '')::uuid;
    IF v_order_id IS NULL THEN
      RAISE EXCEPTION 'Missing order_id';
    END IF;

    -- Ownership check
    IF NOT v_is_service_role THEN
      PERFORM 1 FROM public.orders WHERE id = v_order_id AND user_id = v_caller_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Unauthorized: caller does not own this order';
      END IF;
    END IF;

    SELECT jsonb_build_object(
      'id', o.id,
      'user_id', o.user_id,
      'status', o.status,
      'payment_status', o.payment_status,
      'payment_method', o.payment_method,
      'total', o.total,
      'subtotal', o.subtotal,
      'shipping', o.shipping,
      'tax', o.tax,
      'currency', o.currency,
      'shipping_address', o.shipping_address,
      'billing_address', o.billing_address,
      'shipping_method', o.shipping_method,
      'variable_symbol', o.variable_symbol,
      'bank_transfer_iban', o.bank_transfer_iban,
      'bank_transfer_bic', o.bank_transfer_bic,
      'bank_transfer_amount', o.bank_transfer_amount,
      'bank_transfer_due_date', o.bank_transfer_due_date,
      'invoice_number', o.invoice_number,
      'invoice_pdf_path', o.invoice_pdf_path,
      'invoice_generated_at', o.invoice_generated_at,
      'stripe_payment_intent_id', o.stripe_payment_intent_id,
      'tracking_url', o.tracking_url,
      'packeta_barcode', o.packeta_barcode,
      'created_at', o.created_at,
      'order_items', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', oi.id,
              'product_id', oi.product_id,
              'quantity', oi.quantity,
              'price', oi.price,
              'price_at_purchase', oi.price_at_purchase,
              'product_name', p.name,
              'product_sku', p.sku
            )
          )
          FROM public.order_items oi
          LEFT JOIN public.products p ON p.id = oi.product_id
          WHERE oi.order_id = o.id
        ),
        '[]'::jsonb
      ),
      'user_email', (SELECT email FROM aisha_auth.users WHERE id = o.user_id),
      'profile_name', (SELECT display_name FROM public.profiles WHERE user_id = o.user_id)
    )
    INTO v_row
    FROM public.orders o
    WHERE o.id = v_order_id;

    RETURN jsonb_build_object('row', v_row);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_orders(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_orders(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edge_orders(text, jsonb) TO authenticated;
