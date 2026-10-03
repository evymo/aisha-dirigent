-- Trigger: trg_audit_journal_guard
-- BEFORE UPDATE/DELETE: DELETE forbidden, blockchain_hash immutable once set.
-- See fn_audit_journal_guard for the rebuild escape hatch used by the heals
-- backfill; the TRUNCATE guard lives in trg_audit_journal_guard_truncate.sql.

DROP TRIGGER IF EXISTS trg_audit_journal_guard ON public.audit_journal;
CREATE TRIGGER trg_audit_journal_guard
  BEFORE UPDATE OR DELETE ON public.audit_journal
  FOR EACH ROW
  EXECUTE FUNCTION fn_audit_journal_guard();
