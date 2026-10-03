-- generate_invoice_for_order: Atomically assigns invoice number to order
CREATE OR REPLACE FUNCTION public.generate_invoice_for_order(
  p_order_id uuid,
  p_prefix text DEFAULT 'FAK'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice_number text;
  v_order_status text;
  v_existing_invoice text;
BEGIN
  -- 1. Authorization: admin only
  IF NOT public.has_role(v_user_id, 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- 2. Check order exists and get current state
  SELECT o.status, o.invoice_number
  INTO v_order_status, v_existing_invoice
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_order_status IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- 3. If invoice already exists, return it (idempotent)
  IF v_existing_invoice IS NOT NULL THEN
    RETURN jsonb_build_object(
      'invoice_number', v_existing_invoice,
      'already_existed', true
    );
  END IF;

  -- 4. Generate next invoice number atomically
  v_invoice_number := public.generate_next_invoice_number(p_prefix);

  -- 5. Update order with invoice data
  UPDATE public.orders
  SET
    invoice_number = v_invoice_number,
    invoice_generated_at = now(),
    updated_at = now()
  WHERE id = p_order_id;

  -- 6. Audit log
  PERFORM public.write_audit_journal(
    p_action_type := 'create',
    p_area := 'admin',
    p_details := jsonb_build_object(
      'invoice_number', v_invoice_number,
      'prefix', p_prefix
    ),
    p_entity_id := p_order_id::text,
    p_entity_type := 'invoice',
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'notice',
    p_summary := 'Invoice generated for order',
    p_tags := ARRAY['admin', 'invoice', 'orders'],
    p_user_id := v_user_id
  );

  RETURN jsonb_build_object(
    'invoice_number', v_invoice_number,
    'already_existed', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_invoice_for_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_invoice_for_order(uuid, text) TO authenticated;
