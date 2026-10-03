-- Function: public.fn_blockchain_audit_chain_link
-- Arguments: (none - trigger function, BEFORE INSERT ON blockchain_audit_records)
-- Description: Makes the blockchain_audit_records hash chain REAL. On every INSERT it
--   (1) serializes chain writers with a transaction-scoped advisory lock,
--   (2) preserves any caller-supplied record_hash (legacy "payload hash" semantic from
--       edge_blockchain_audit / fn_anchor_decision) into data.payload_hash so nothing is lost,
--   (3) fills previous_hash from the current chain tip (the one row whose record_hash is
--       not referenced by any other row's previous_hash; genesis constant for an empty table),
--   (4) recomputes record_hash deterministically via fn_audit_ledger_record_hash over the
--       row's stored columns INCLUDING previous_hash — the chain link.
--   Fail-loud: if rows exist but no unique tip is found the ledger is unhealed/broken and
--   the INSERT is rejected (run the heals backfill / fn_verify_audit_chain), never silently
--   forked. ON CONFLICT DO NOTHING inserters (fn_queue_blockchain_sync) stay correct: a
--   skipped row never becomes the tip, so the next insert re-reads the same tip.
-- Security: SECURITY DEFINER trigger function, search_path pinned, service_role-only EXECUTE.

CREATE OR REPLACE FUNCTION public.fn_blockchain_audit_chain_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tips text[];
  v_prev text;
BEGIN
  -- Serialize concurrent chain writers; released at COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtextextended('public.blockchain_audit_records:hash_chain', 0));

  -- Preserve the caller-supplied payload hash (pre-chain record_hash semantic).
  IF NEW.record_hash IS NOT NULL AND (NEW.data IS NULL OR NOT (NEW.data ? 'payload_hash')) THEN
    NEW.data := COALESCE(NEW.data, '{}'::jsonb) || jsonb_build_object('payload_hash', NEW.record_hash);
  END IF;

  -- Current chain tip: the row whose record_hash no other row points at.
  SELECT array_agg(r.record_hash) INTO v_tips
  FROM public.blockchain_audit_records r
  WHERE r.record_hash IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.blockchain_audit_records c
      WHERE c.previous_hash = r.record_hash
    );

  IF v_tips IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.blockchain_audit_records) THEN
      RAISE EXCEPTION 'audit ledger: rows exist but no chain tip found — run the heals backfill (aisha/db/heals.sql) before inserting';
    END IF;
    v_prev := repeat('0', 64); -- genesis
  ELSIF array_length(v_tips, 1) > 1 THEN
    RAISE EXCEPTION 'audit ledger: % chain tips found — chain is broken or unhealed; run fn_verify_audit_chain() / the heals backfill', array_length(v_tips, 1);
  ELSE
    v_prev := v_tips[1];
  END IF;

  NEW.previous_hash := v_prev;
  NEW.record_hash := public.fn_audit_ledger_record_hash(
    NEW.previous_hash,
    NEW.record_type,
    NEW.data,
    NEW.reference_table,
    NEW.reference_id,
    NEW.token_transaction_id,
    NEW.correlation_id,
    NEW.created_at
  );

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_blockchain_audit_chain_link() IS
  'BEFORE INSERT trigger fn: links each blockchain_audit_records row to the chain tip '
  '(previous_hash) and computes the deterministic chained record_hash. Fail-loud on broken/unhealed chain.';

-- Permissions — trigger function: not callable directly by clients.
REVOKE ALL ON FUNCTION public.fn_blockchain_audit_chain_link() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_blockchain_audit_chain_link() TO service_role;
