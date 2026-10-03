-- Trigger: trigger_audit_journal_set_action

CREATE TRIGGER trigger_audit_journal_set_action
  BEFORE INSERT ON public.audit_journal
  FOR EACH ROW
  EXECUTE FUNCTION audit_journal_set_action();
