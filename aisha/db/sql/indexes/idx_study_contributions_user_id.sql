-- Index: idx_study_contributions_user_id
-- Table: study_contributions

CREATE INDEX IF NOT EXISTS idx_study_contributions_user_id
  ON public.study_contributions USING btree (user_id);
