-- Index: idx_studies_parent_study_id
-- Table: studies

CREATE INDEX idx_studies_parent_study_id ON public.studies USING btree (parent_study_id);
