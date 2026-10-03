-- Index: idx_audit_journal_user_created
-- Table: audit_journal

CREATE INDEX IF NOT EXISTS idx_audit_journal_user_created
  ON public.audit_journal USING btree (user_id, created_at DESC);

-- ============================================================================
-- consents — user consent lookups (RLS, study registration checks)
-- ============================================================================
