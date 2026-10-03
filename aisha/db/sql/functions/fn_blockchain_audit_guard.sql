-- Function: public.fn_blockchain_audit_guard
-- Arguments: (none - trigger function, BEFORE UPDATE/DELETE + TRUNCATE ON blockchain_audit_records)
-- Description: In-database tamper guard for the audit ledger. The chain-carrying columns
--   (id, record_type, data, record_hash, previous_hash, created_at, correlation_id,
--   token_transaction_id, reference_table, reference_id) are immutable after INSERT;
--   only the outbox status machine (status, retry_count, max_attempts, next_retry_at,
--   processing_started_at, updated_at, cosmos_tx_hash, error_message) may change.
--   DELETE and TRUNCATE are rejected — a removed row is a broken chain link.
--   Escape hatch: the transaction-local GUC aisha.audit_ledger_rebuild='on' is set ONLY by
--   the idempotent heals backfill (aisha/db/heals.sql) that (re)builds the chain on existing
--   DBs. This guards against application bugs and casual tampering, not superusers — real
--   external tamper-evidence is Path 2 (anchoring the chain head on the Cosmos ledger).
-- Security: SECURITY DEFINER trigger function, search_path pinned, service_role-only EXECUTE.

CREATE OR REPLACE FUNCTION public.fn_blockchain_audit_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Explicit, transaction-local rebuild path (heals backfill only).
  IF current_setting('aisha.audit_ledger_rebuild', true) = 'on' THEN
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit ledger: TRUNCATE forbidden on blockchain_audit_records (tamper-evident chain)';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit ledger: DELETE forbidden on blockchain_audit_records (tamper-evident chain), id=%', OLD.id;
  END IF;

  IF NEW.id                   IS DISTINCT FROM OLD.id
     OR NEW.record_type          IS DISTINCT FROM OLD.record_type
     OR NEW.data                 IS DISTINCT FROM OLD.data
     OR NEW.record_hash          IS DISTINCT FROM OLD.record_hash
     OR NEW.previous_hash        IS DISTINCT FROM OLD.previous_hash
     OR NEW.created_at           IS DISTINCT FROM OLD.created_at
     OR NEW.correlation_id       IS DISTINCT FROM OLD.correlation_id
     OR NEW.token_transaction_id IS DISTINCT FROM OLD.token_transaction_id
     OR NEW.reference_table      IS DISTINCT FROM OLD.reference_table
     OR NEW.reference_id         IS DISTINCT FROM OLD.reference_id
  THEN
    RAISE EXCEPTION 'audit ledger: immutable column update forbidden on blockchain_audit_records, id=%', OLD.id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_blockchain_audit_guard() IS
  'Tamper guard trigger fn for blockchain_audit_records: chain columns immutable, '
  'DELETE/TRUNCATE forbidden; only the outbox status machine may be updated.';

-- Permissions — trigger function: not callable directly by clients.
REVOKE ALL ON FUNCTION public.fn_blockchain_audit_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_blockchain_audit_guard() TO service_role;
