-- setup_bank_transfer_for_order: Setup bank transfer payment for a pending order
CREATE OR REPLACE FUNCTION public.setup_bank_transfer_for_order(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_order orders%ROWTYPE;
  v_vs text;
  v_iban text;
  v_bic text;
  v_due_days int;
  v_due_date timestamptz;
  v_invoice_header jsonb;
  v_payment_methods jsonb;
BEGIN
  -- Authorization: must be order owner
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_order.status NOT IN ('pending') THEN
    RAISE EXCEPTION 'Order is not in pending status' USING ERRCODE = 'P0001';
  END IF;

  -- Get invoice header config (IBAN, BIC)
  SELECT value INTO v_invoice_header
  FROM public.system_config WHERE key = 'invoice_header';

  v_iban := COALESCE(v_invoice_header ->> 'bank_account_iban', '');
  v_bic := COALESCE(v_invoice_header ->> 'bank_account_bic', '');

  IF v_iban = '' THEN
    RAISE EXCEPTION 'Bank account IBAN not configured in system settings' USING ERRCODE = 'P0001';
  END IF;

  -- Get payment methods config (due days)
  SELECT value INTO v_payment_methods
  FROM public.system_config WHERE key = 'payment_methods';

  v_due_days := COALESCE((v_payment_methods ->> 'bank_transfer_due_days')::int, 7);
  v_due_date := now() + (v_due_days || ' days')::interval;

  -- Generate variable symbol
  v_vs := public.generate_variable_symbol(p_order_id);

  -- Update order with bank transfer details
  UPDATE public.orders SET
    payment_method = 'bank_transfer',
    payment_status = 'awaiting_transfer',
    status = 'awaiting_payment',
    variable_symbol = v_vs,
    bank_transfer_iban = v_iban,
    bank_transfer_bic = v_bic,
    bank_transfer_amount = total,
    bank_transfer_due_date = v_due_date,
    updated_at = now()
  WHERE id = p_order_id;

  -- Audit
  PERFORM public.write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area := 'commerce'::journal_area,
    p_details := jsonb_build_object(
      'payment_method', 'bank_transfer',
      'variable_symbol', v_vs,
      'amount', v_order.total,
      'due_date', v_due_date
    ),
    p_entity_id := p_order_id::text,
    p_entity_type := 'order',
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'info'::journal_severity,
    p_summary := 'Bank transfer payment setup for order',
    p_tags := ARRAY['order', 'payment', 'bank_transfer'],
    p_user_id := v_user_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'variable_symbol', v_vs,
    'iban', v_iban,
    'bic', v_bic,
    'amount', v_order.total,
    'currency', v_order.currency,
    'due_date', v_due_date
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.setup_bank_transfer_for_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.setup_bank_transfer_for_order(uuid) TO authenticated;
