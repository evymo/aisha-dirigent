-- Function: fn_queue_blockchain_sync
-- Trigger function for token_transactions INSERT → queue blockchain sync
-- Fires in SAME transaction as the token_transaction INSERT (transactional outbox).
--
-- GDPR filter: only 'governance' and 'aisha' token types go on-chain.
-- 'impact' and 'data' tokens are NEVER sent to blockchain (GDPR Art. 17).
--
-- Pattern: fn_queue_embedding_generation (pg_notify + pg_net + graceful degradation)
--
-- Requires app settings (optional, graceful degradation):
--   app.settings.supabase_functions_internal_url  (e.g. http://gateway:8000)
--   app.settings.supabase_service_role_key        (service role JWT)

CREATE OR REPLACE FUNCTION public.fn_queue_blockchain_sync()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_correlation_id uuid;
  v_payload jsonb;
  v_functions_url text;
  v_service_key text;
  v_request_id bigint;
  v_ledger_enabled boolean;
  v_participates boolean;
  v_anchor_on_chain boolean;
BEGIN
  -- GDPR filter: only on-chain eligible token types
  IF NEW.token_type NOT IN ('governance', 'aisha') THEN
    RETURN NEW;
  END IF;

  -- D2 opt-out DECISION POINT: the IN-DB hash-chain book (the outbox INSERT below
  -- plus the unconditional chain-link/guard triggers) is ALWAYS ON. Only NEW
  -- on-chain / personal anchoring (dispatch to the Cosmos chain) is opt-out-able,
  -- gated by BOTH the per-instance LEDGER_ENABLED flag (read as the ledger_enabled
  -- GUC, default on) AND the member's ledger_participation (default true / absent =
  -- participating). This never stops the book from recording.
  v_ledger_enabled := COALESCE(
    NULLIF(current_setting('app.settings.ledger_enabled', true), ''), 'true'
  ) NOT IN ('false', '0', 'off', 'no');

  SELECT lp.participates INTO v_participates
  FROM public.ledger_participation lp
  WHERE lp.user_id = NEW.user_id;
  v_participates := COALESCE(v_participates, true);

  v_anchor_on_chain := v_ledger_enabled AND v_participates;

  v_correlation_id := gen_random_uuid();

  -- Transactional outbox: INSERT in SAME TX as token_transaction
  -- ON CONFLICT = idempotency (duplicate trigger protection)
  INSERT INTO blockchain_audit_records (
    record_type,
    data,
    status,
    correlation_id,
    token_transaction_id,
    reference_table,
    reference_id
  ) VALUES (
    'token_sync',
    jsonb_build_object(
      'user_id', NEW.user_id,
      'amount', NEW.amount,
      'token_type', NEW.token_type,
      'transaction_type', NEW.transaction_type,
      'description', NEW.description,
      -- D2: whether this book row may be anchored on-chain (layer 2). The
      -- svc-blockchain dispatcher honours this flag before broadcasting.
      'on_chain_anchor', v_anchor_on_chain
    ),
    'queued',
    v_correlation_id,
    NEW.id,
    'token_transactions',
    NEW.id
  )
  ON CONFLICT (reference_table, reference_id) WHERE reference_id IS NOT NULL
  DO NOTHING;

  -- If ON CONFLICT hit, skip dispatch (already queued)
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Audit trail — the book row was recorded regardless of the anchor decision.
  PERFORM public.write_audit_journal(
    p_action_type := 'create'::journal_action_type,
    p_area := 'blockchain'::journal_area,
    p_details := jsonb_build_object(
      'token_type', NEW.token_type,
      'correlation_id', v_correlation_id,
      'on_chain_anchor', v_anchor_on_chain
    ),
    p_entity_id := NEW.id::text,
    p_entity_type := 'token_transaction',
    p_severity := 'info'::journal_severity,
    p_summary := CASE WHEN v_anchor_on_chain
                   THEN 'Blockchain sync queued'
                   ELSE 'Ledger book recorded (on-chain anchoring opted out)' END,
    p_user_id := COALESCE(auth.uid(), NEW.user_id)
  );

  -- On-chain DISPATCH (layer 2) — skipped entirely when the instance
  -- (LEDGER_ENABLED) or the member (ledger_participation) has opted out. The book
  -- row above still exists and stays tamper-evident; only the Cosmos broadcast is
  -- suppressed.
  IF v_anchor_on_chain THEN
    -- Build notification payload
    v_payload := jsonb_build_object(
      'correlation_id', v_correlation_id,
      'token_transaction_id', NEW.id,
      'token_type', NEW.token_type,
      'triggered_at', now()
    );

    -- 1. pg_notify for external listeners (n8n, custom workers)
    PERFORM pg_notify('blockchain_sync', v_payload::text);

    -- 2. Direct edge function call via pg_net (if configured)
    BEGIN
      v_functions_url := current_setting('app.settings.supabase_functions_internal_url', true);
      v_service_key := current_setting('app.settings.supabase_service_role_key', true);

      IF v_functions_url IS NOT NULL AND v_functions_url != ''
         AND v_service_key IS NOT NULL AND v_service_key != ''
      THEN
        SELECT net.http_post(
          url     := v_functions_url || '/functions/v1/blockchain-dispatch',
          body    := v_payload,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_key
          )
        ) INTO v_request_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- pg_net not available or HTTP call failed — pg_notify still works
      PERFORM public.write_audit_journal(
        p_action_type := 'error'::journal_action_type,
        p_area := 'blockchain'::journal_area,
        p_details := jsonb_build_object('error', SQLERRM),
        p_entity_id := NEW.id::text,
        p_entity_type := 'token_transaction',
        p_severity := 'warning'::journal_severity,
        p_summary := 'Blockchain dispatch failed',
        p_user_id := COALESCE(auth.uid(), NEW.user_id)
      );
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION fn_queue_blockchain_sync() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_queue_blockchain_sync() TO service_role;
