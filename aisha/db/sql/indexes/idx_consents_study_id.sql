-- Index: idx_consents_study_id
-- Table: consents

CREATE INDEX IF NOT EXISTS idx_consents_study_id
  ON public.consents USING btree (study_id)
  WHERE study_id IS NOT NULL;

-- ============================================================================
-- partner_availability — booking slot lookups
-- ============================================================================
