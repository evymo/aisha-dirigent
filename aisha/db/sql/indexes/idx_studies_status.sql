-- Index: idx_studies_status
-- Table: studies

CREATE INDEX idx_studies_status ON public.studies USING btree (status);
