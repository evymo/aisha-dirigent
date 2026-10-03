-- Function: public.fn_audit_journal_guard
-- Arguments: (none - trigger function, BEFORE UPDATE/DELETE + TRUNCATE ON audit_journal)
-- Description: Tamper guard for the SECOND audit surface — audit_journal, the sink
--   ~200 *_audited RPCs write via write_audit_journal. It makes audit_journal
--   tamper-evident like blockchain_audit_records:
--     • DELETE and TRUNCATE are rejected — a removed audit row is a broken record.
--     • the per-row content hash (blockchain_hash) is IMMUTABLE once set; a row
--       may still transition its chain-sync status columns (blockchain_tx_hash,
--       blockchain_recorded_at, blockchain_status) and trace-correlation columns
--       (ai_run_id, langfuse_trace_id) — those are not the content fingerprint.
--   Escape hatch: the transaction-local GUC aisha.audit_ledger_rebuild='on' (set
--   ONLY by the idempotent heals backfill) permits a hash (re)build on existing DBs.
--   Guards against application bugs / casual tampering, not superusers — external
--   tamper-evidence is the on-chain anchor of the chain head.
-- Security: SECURITY DEFINER trigger function, search_path pinned, service_role-only EXECUTE.

CREATE OR REPLACE FUNCTION public.fn_audit_journal_guard()
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
    RAISE EXCEPTION 'audit ledger: TRUNCATE forbidden on audit_journal (tamper-evident journal)';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit ledger: DELETE forbidden on audit_journal (tamper-evident journal), id=%', OLD.id;
  END IF;

  -- UPDATE: the content fingerprint is immutable once set. Mutating it is tampering.
  IF OLD.blockchain_hash IS NOT NULL
     AND NEW.blockchain_hash IS DISTINCT FROM OLD.blockchain_hash
  THEN
    RAISE EXCEPTION 'audit ledger: blockchain_hash is immutable on audit_journal, id=%', OLD.id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_audit_journal_guard() IS
  'Tamper guard trigger fn for audit_journal: DELETE/TRUNCATE forbidden, blockchain_hash '
  'immutable once set; chain-sync status + trace-correlation columns stay mutable.';

REVOKE ALL ON FUNCTION public.fn_audit_journal_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_audit_journal_guard() TO service_role;
