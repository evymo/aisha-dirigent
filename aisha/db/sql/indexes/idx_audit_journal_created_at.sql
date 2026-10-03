-- Index: idx_audit_journal_created_at
-- Table: audit_journal

CREATE INDEX IF NOT EXISTS idx_audit_journal_created_at
  ON public.audit_journal USING btree (created_at DESC);
