CREATE OR REPLACE FUNCTION public.edge_stripe_disputes(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dispute_id uuid;
  v_stripe_dispute_id text;
  v_order_id uuid;
  v_result jsonb;
BEGIN
  -- ========== UPSERT DISPUTE ==========
  IF p_action = 'upsert_dispute' THEN
    v_stripe_dispute_id := NULLIF(p_payload ->> 'stripe_dispute_id', '');
    IF v_stripe_dispute_id IS NULL THEN
      RAISE EXCEPTION 'Missing stripe_dispute_id';
    END IF;

    INSERT INTO public.stripe_disputes (
      amount,
      currency,
      evidence_due_by,
      is_charge_refundable,
      metadata,
      order_id,
      reason,
      status,
      stripe_charge_id,
      stripe_dispute_id,
      stripe_payment_intent_id,
      user_id
    ) VALUES (
      COALESCE((p_payload ->> 'amount')::bigint, 0),
      COALESCE(p_payload ->> 'currency', public.commerce_base_currency()),
      CASE WHEN p_payload ? 'evidence_due_by' THEN (p_payload ->> 'evidence_due_by')::timestamptz ELSE NULL END,
      COALESCE((p_payload ->> 'is_charge_refundable')::boolean, false),
      COALESCE(p_payload -> 'metadata', '{}'::jsonb),
      CASE WHEN p_payload ? 'order_id' THEN (p_payload ->> 'order_id')::uuid ELSE NULL END,
      p_payload ->> 'reason',
      COALESCE(p_payload ->> 'status', 'needs_response'),
      COALESCE(p_payload ->> 'stripe_charge_id', ''),
      v_stripe_dispute_id,
      p_payload ->> 'stripe_payment_intent_id',
      CASE WHEN p_payload ? 'user_id' THEN (p_payload ->> 'user_id')::uuid ELSE NULL END
    )
    ON CONFLICT (stripe_dispute_id) DO UPDATE SET
      amount = COALESCE((p_payload ->> 'amount')::bigint, stripe_disputes.amount),
      closed_at = CASE WHEN p_payload ? 'closed_at' THEN (p_payload ->> 'closed_at')::timestamptz ELSE stripe_disputes.closed_at END,
      evidence_due_by = CASE WHEN p_payload ? 'evidence_due_by' THEN (p_payload ->> 'evidence_due_by')::timestamptz ELSE stripe_disputes.evidence_due_by END,
      is_charge_refundable = COALESCE((p_payload ->> 'is_charge_refundable')::boolean, stripe_disputes.is_charge_refundable),
      metadata = COALESCE(p_payload -> 'metadata', stripe_disputes.metadata),
      reason = COALESCE(p_payload ->> 'reason', stripe_disputes.reason),
      status = COALESCE(p_payload ->> 'status', stripe_disputes.status),
      updated_at = now()
    RETURNING id INTO v_dispute_id;

    RETURN jsonb_build_object('ok', true, 'dispute_id', v_dispute_id);
  END IF;

  -- ========== UPDATE DISPUTE STATUS ==========
  IF p_action = 'update_status' THEN
    v_stripe_dispute_id := NULLIF(p_payload ->> 'stripe_dispute_id', '');
    IF v_stripe_dispute_id IS NULL THEN
      RAISE EXCEPTION 'Missing stripe_dispute_id';
    END IF;

    UPDATE public.stripe_disputes
    SET
      closed_at = CASE WHEN p_payload ? 'closed_at' THEN (p_payload ->> 'closed_at')::timestamptz ELSE closed_at END,
      status = COALESCE(p_payload ->> 'status', status),
      updated_at = now()
    WHERE stripe_dispute_id = v_stripe_dispute_id
    RETURNING order_id INTO v_order_id;

    -- Also update order dispute_status if linked
    IF v_order_id IS NOT NULL THEN
      UPDATE public.orders
      SET
        dispute_status = COALESCE(p_payload ->> 'status', dispute_status),
        updated_at = now()
      WHERE id = v_order_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'updated', FOUND);
  END IF;

  -- ========== FIND ORDER BY PAYMENT INTENT ==========
  IF p_action = 'find_order_by_payment_intent' THEN
    SELECT jsonb_build_object(
      'order_id', o.id,
      'user_id', o.user_id
    ) INTO v_result
    FROM public.orders o
    WHERE o.stripe_payment_intent_id = (p_payload ->> 'stripe_payment_intent_id')
    LIMIT 1;

    RETURN COALESCE(v_result, jsonb_build_object('order_id', NULL, 'user_id', NULL));
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_stripe_disputes(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_stripe_disputes(text, jsonb) TO service_role;
