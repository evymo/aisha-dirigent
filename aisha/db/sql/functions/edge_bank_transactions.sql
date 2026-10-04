-- edge_bank_transactions: Edge-safe bank transaction operations (insert, match, list)
CREATE OR REPLACE FUNCTION public.edge_bank_transactions(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
  v_rows jsonb;
  v_tx_id text;
  v_order_id uuid;
BEGIN
  -- ⛔ SECURITY DEFINER vypíná RLS, takže nárok musí vymáhat tělo. Do 2026-10-04
  -- tu žádná stráž nebyla a funkce má GRANT pro `authenticated` (admin UI ji volá
  -- přímo): kdokoli přihlášený si přímým /rpc/edge_bank_transactions mohl
  -- označit vlastní objednávku za zaplacenou (match_to_order), podstrčit
  -- platbu (insert_transaction) a přečíst účty a jména plátců (get_unmatched).
  -- Zápis pohybů z banky dělá jen služba (svc-fio-bank); párování a frontu
  -- nespárovaných admin/staff. get_order_bank_transfer stráží vlastníka níž.
  IF p_action = 'insert_transaction' AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_action IN ('match_to_order', 'get_unmatched')
     AND NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- INSERT a new bank transaction (deduplicate by fio_transaction_id)
  IF p_action = 'insert_transaction' THEN
    v_tx_id := NULLIF(p_payload ->> 'fio_transaction_id', '');

    -- Check for duplicate
    IF v_tx_id IS NOT NULL THEN
      SELECT id INTO v_order_id FROM public.bank_transactions WHERE fio_transaction_id = v_tx_id;
      IF FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'duplicate');
      END IF;
    END IF;

    INSERT INTO public.bank_transactions (
      fio_transaction_id, amount, currency, variable_symbol,
      sender_account, sender_name, transaction_date, message,
      match_status, raw_data
    ) VALUES (
      v_tx_id,
      (p_payload ->> 'amount')::numeric,
      COALESCE(NULLIF(p_payload ->> 'currency', ''), public.commerce_base_currency()),
      NULLIF(p_payload ->> 'variable_symbol', ''),
      NULLIF(p_payload ->> 'sender_account', ''),
      NULLIF(p_payload ->> 'sender_name', ''),
      (NULLIF(p_payload ->> 'transaction_date', ''))::date,
      NULLIF(p_payload ->> 'message', ''),
      COALESCE(NULLIF(p_payload ->> 'match_status', ''), 'unmatched'),
      p_payload -> 'raw_data'
    );

    RETURN jsonb_build_object('ok', true);
  END IF;

  -- MATCH a transaction to an order
  IF p_action = 'match_to_order' THEN
    v_order_id := (p_payload ->> 'order_id')::uuid;

    UPDATE public.bank_transactions
    SET matched_order_id = v_order_id,
        match_status = 'matched',
        match_notes = NULLIF(p_payload ->> 'notes', '')
    WHERE id = (p_payload ->> 'transaction_id')::uuid;

    -- Update order payment status
    UPDATE public.orders
    SET payment_status = 'paid',
        status = 'paid',
        updated_at = now()
    WHERE id = v_order_id
      AND payment_status = 'awaiting_transfer';

    RETURN jsonb_build_object('ok', true);
  END IF;

  -- LIST unmatched transactions (admin)
  IF p_action = 'get_unmatched' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', bt.id,
        'fio_transaction_id', bt.fio_transaction_id,
        'amount', bt.amount,
        'currency', bt.currency,
        'variable_symbol', bt.variable_symbol,
        'sender_account', bt.sender_account,
        'sender_name', bt.sender_name,
        'transaction_date', bt.transaction_date,
        'message', bt.message,
        'match_status', bt.match_status,
        'created_at', bt.created_at
      ) ORDER BY bt.transaction_date DESC NULLS LAST
    ), '[]'::jsonb) INTO v_rows
    FROM public.bank_transactions bt
    WHERE bt.match_status IN ('unmatched', 'amount_mismatch');

    RETURN jsonb_build_object('rows', v_rows);
  END IF;

  -- GET bank transfer details for an order (member view)
  IF p_action = 'get_order_bank_transfer' THEN
    v_order_id := (p_payload ->> 'order_id')::uuid;

    SELECT jsonb_build_object(
      'order_id', o.id,
      'variable_symbol', o.variable_symbol,
      'iban', o.bank_transfer_iban,
      'bic', o.bank_transfer_bic,
      'amount', o.bank_transfer_amount,
      'currency', o.currency,
      'due_date', o.bank_transfer_due_date,
      'payment_method', o.payment_method,
      'payment_status', o.payment_status,
      'status', o.status,
      'total', o.total,
      'invoice_number', o.invoice_number,
      'invoice_pdf_path', o.invoice_pdf_path
    ) INTO v_row
    FROM public.orders o
    WHERE o.id = v_order_id
      AND (o.user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role IN ('admin', 'staff')
      ));

    RETURN jsonb_build_object('row', v_row);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_bank_transactions(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_bank_transactions(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edge_bank_transactions(text, jsonb) TO authenticated;
