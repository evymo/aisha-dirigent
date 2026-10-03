-- Trigger: trg_blockchain_audit_guard
-- BEFORE UPDATE/DELETE: chain-carrying columns are immutable, DELETE forbidden.
-- See fn_blockchain_audit_guard for the rebuild escape hatch used by the heals
-- backfill; TRUNCATE guard lives in trg_blockchain_audit_guard_truncate.sql.

DROP TRIGGER IF EXISTS trg_blockchain_audit_guard ON public.blockchain_audit_records;
CREATE TRIGGER trg_blockchain_audit_guard
  BEFORE UPDATE OR DELETE ON public.blockchain_audit_records
  FOR EACH ROW
  EXECUTE FUNCTION fn_blockchain_audit_guard();
