-- Trigger: trg_audit_journal_guard_truncate
-- BEFORE TRUNCATE (statement-level): forbidden — a truncated journal is a
-- destroyed audit record. Same guard fn + rebuild escape hatch as the row trigger.

DROP TRIGGER IF EXISTS trg_audit_journal_guard_truncate ON public.audit_journal;
CREATE TRIGGER trg_audit_journal_guard_truncate
  BEFORE TRUNCATE ON public.audit_journal
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_audit_journal_guard();
