-- Index: idx_study_contributions_study_id
-- Table: study_contributions

CREATE INDEX IF NOT EXISTS idx_study_contributions_study_id
  ON public.study_contributions USING btree (study_id);
