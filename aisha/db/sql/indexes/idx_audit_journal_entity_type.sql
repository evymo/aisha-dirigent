-- Index: idx_audit_journal_entity_type
-- Table: audit_journal

CREATE INDEX IF NOT EXISTS idx_audit_journal_entity_type
  ON public.audit_journal USING btree (entity_type)
  WHERE entity_type IS NOT NULL;
