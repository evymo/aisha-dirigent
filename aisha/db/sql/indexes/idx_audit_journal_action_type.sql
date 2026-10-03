-- Index: idx_audit_journal_action_type
-- Table: audit_journal

CREATE INDEX IF NOT EXISTS idx_audit_journal_action_type
  ON public.audit_journal USING btree (action_type);
