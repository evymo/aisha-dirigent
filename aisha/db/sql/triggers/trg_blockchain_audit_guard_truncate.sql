-- Trigger: trg_blockchain_audit_guard_truncate
-- BEFORE TRUNCATE (statement-level): forbidden — a truncated ledger is a
-- destroyed chain. Same guard fn + rebuild escape hatch as the row trigger.

DROP TRIGGER IF EXISTS trg_blockchain_audit_guard_truncate ON public.blockchain_audit_records;
CREATE TRIGGER trg_blockchain_audit_guard_truncate
  BEFORE TRUNCATE ON public.blockchain_audit_records
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_blockchain_audit_guard();
