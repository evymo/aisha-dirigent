-- Index: idx_study_contributions_status
-- Table: study_contributions

CREATE INDEX IF NOT EXISTS idx_study_contributions_status
  ON public.study_contributions USING btree (status);

-- ============================================================================
-- data_sharing_consents — user consent lookups by RLS and consent checks
-- ============================================================================
