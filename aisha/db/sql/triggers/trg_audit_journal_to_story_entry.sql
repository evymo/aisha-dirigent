-- Trigger: trg_audit_journal_to_story_entry
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER trg_audit_journal_to_story_entry AFTER INSERT ON public.audit_journal FOR EACH ROW WHEN ((new.area = ANY (ARRAY['outreach'::text, 'crm_ops'::text, 'crm'::text]))) EXECUTE FUNCTION audience_audit_to_story_entry();
