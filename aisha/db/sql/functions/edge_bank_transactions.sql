-- edge_bank_transactions: Edge-safe bank transaction operations (insert, match, list)
--   služba (svc-fio-bank, rpcService):            insert_transaction, auto_match_by_vs
--   správa (admin UI useBankReconciliation):       get_unmatched, get_all, get_awaiting_orders,
--                                                  match_to_order, dismiss_transaction
--   vlastník objednávky (useOrderBankTransfer):    get_order_bank_transfer
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
  v_expected numeric;
  v_order_currency text;
  v_tx_uuid uuid;
  v_limit int;
BEGIN
  -- ⛔ NÁROK PŘED DISPEČEREM, VÝCHOZÍ ODMÍTNUTÍ (nález 2026-10-06; ve stagingu
  -- opraveno 10-04, upstream to nedostal). SECURITY DEFINER vypíná RLS a funkce má
  -- GRANT pro authenticated (admin UI ji volá přímo), ale stráž tu nebyla: kdokoli
  -- přihlášený si přímým /rpc/edge_bank_transactions označil VLASTNÍ objednávku za
  -- zaplacenou (match_to_order → orders.status = 'paid'), vložil falešný bankovní
  -- pohyb (insert_transaction) a přečetl účty a jména plátců (get_unmatched).
  -- Členovi patří jen VYJMENOVANÁ akce get_order_bank_transfer (vlastnictví hlídá
  -- její dotaz); každá jiná — i budoucí — chce službu nebo správu. Pohyby z banky
  -- zapisuje jen služba. `IS NOT TRUE`, ne `NOT (…)`: NULL nesmí stráž přeskočit.
  -- Třídu hlídá src/tests/gates/definer-dispecer-autorizuje-kazdou-akci.gate.test.ts.
  IF p_action IS DISTINCT FROM 'get_order_bank_transfer'
     AND (public.is_service_role() OR public.is_admin_or_staff()) IS NOT TRUE THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_action IN ('insert_transaction', 'auto_match_by_vs') AND public.is_service_role() IS NOT TRUE THEN
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
        match_type = 'manual',
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

  -- ⛔ DO 2026-10-04 NÁSLEDUJÍCÍ ČTYŘI AKCE NEEXISTOVALY, ačkoli je volali
  -- klienti: svc-fio-bank `auto_match_by_vs` (po prvním pohybu s VS spadla celá
  -- synchronizace na „Unsupported action") a admin UI `get_all`,
  -- `get_awaiting_orders`, `dismiss_transaction` (stránka párování ukazovala
  -- chybu místo dat). Tvar odpovědí odpovídá Zod schématům v
  -- src/hooks/useBankReconciliation.ts a očekávání svc-fio-bank.

  -- AUTO-MATCH právě vloženého pohybu na objednávku podle variabilního symbolu.
  -- Zaplaceno jen při PŘESNÉ shodě částky (a měny, je-li známá) — přeplatek
  -- i nedoplatek jde adminovi jako amount_mismatch, nic se nedomýšlí.
  IF p_action = 'auto_match_by_vs' THEN
    SELECT o.id, COALESCE(o.bank_transfer_amount, o.total), o.currency
      INTO v_order_id, v_expected, v_order_currency
    FROM public.orders o
    WHERE o.variable_symbol = NULLIF(p_payload ->> 'variable_symbol', '')
      AND o.payment_status = 'awaiting_transfer'
    ORDER BY o.created_at DESC
    LIMIT 1;

    IF v_order_id IS NULL THEN
      RETURN jsonb_build_object('matched', false, 'reason', 'no_order');
    END IF;

    SELECT bt.id INTO v_tx_uuid
    FROM public.bank_transactions bt
    WHERE bt.variable_symbol = NULLIF(p_payload ->> 'variable_symbol', '')
      AND bt.match_status = 'unmatched'
    ORDER BY bt.created_at DESC
    LIMIT 1;

    IF v_tx_uuid IS NULL THEN
      RETURN jsonb_build_object('matched', false, 'reason', 'no_transaction');
    END IF;

    IF (p_payload ->> 'amount')::numeric IS DISTINCT FROM v_expected
       OR (NULLIF(p_payload ->> 'currency', '') IS NOT NULL AND v_order_currency IS NOT NULL
           AND upper(p_payload ->> 'currency') <> upper(v_order_currency)) THEN
      UPDATE public.bank_transactions
      SET match_status = 'amount_mismatch',
          matched_order_id = v_order_id,
          match_type = 'auto_vs',
          match_notes = format('Očekáváno %s %s', v_expected, COALESCE(v_order_currency, ''))
      WHERE id = v_tx_uuid;
      RETURN jsonb_build_object('matched', false, 'reason', 'amount_mismatch', 'order_id', v_order_id);
    END IF;

    UPDATE public.bank_transactions
    SET matched_order_id = v_order_id,
        match_status = 'matched',
        match_type = 'auto_vs'
    WHERE id = v_tx_uuid;

    UPDATE public.orders
    SET payment_status = 'paid',
        status = 'paid',
        updated_at = now()
    WHERE id = v_order_id
      AND payment_status = 'awaiting_transfer';

    RETURN jsonb_build_object('matched', true, 'order_id', v_order_id);
  END IF;

  -- LIST all transactions (admin), newest first
  IF p_action = 'get_all' THEN
    v_limit := LEAST(GREATEST(COALESCE(NULLIF(p_payload ->> 'limit', '')::int, 500), 1), 2000);
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'fio_transaction_id', t.fio_transaction_id,
        'amount', t.amount,
        'currency', COALESCE(t.currency, public.commerce_base_currency()),
        'variable_symbol', t.variable_symbol,
        'sender_account', t.sender_account,
        'sender_name', t.sender_name,
        'transaction_date', t.transaction_date,
        'message', t.message,
        'match_status', t.match_status,
        'match_type', t.match_type,
        'match_notes', t.match_notes,
        'matched_order_id', t.matched_order_id,
        'created_at', t.created_at
      ) ORDER BY t.transaction_date DESC NULLS LAST, t.created_at DESC
    ), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT bt.*
      FROM public.bank_transactions bt
      ORDER BY bt.transaction_date DESC NULLS LAST, bt.created_at DESC
      LIMIT v_limit
    ) t;

    RETURN jsonb_build_object('rows', v_rows);
  END IF;

  -- LIST orders awaiting a bank transfer (admin, manual matching)
  IF p_action = 'get_awaiting_orders' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'total', o.total,
        'currency', COALESCE(o.currency, public.commerce_base_currency()),
        'variable_symbol', o.variable_symbol,
        'bank_transfer_amount', o.bank_transfer_amount,
        'bank_transfer_due_date', o.bank_transfer_due_date,
        'created_at', o.created_at
      ) ORDER BY o.created_at DESC
    ), '[]'::jsonb) INTO v_rows
    FROM public.orders o
    WHERE o.payment_status = 'awaiting_transfer';

    RETURN jsonb_build_object('rows', v_rows);
  END IF;

  -- DISMISS (ignore) a transaction that is not a payment for any order (admin)
  IF p_action = 'dismiss_transaction' THEN
    UPDATE public.bank_transactions
    SET match_status = 'dismissed',
        match_notes = NULLIF(p_payload ->> 'notes', '')
    WHERE id = (p_payload ->> 'transaction_id')::uuid
      AND match_status IN ('unmatched', 'amount_mismatch');

    RETURN jsonb_build_object('ok', FOUND);
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
