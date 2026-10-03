-- Index: idx_lab_results_registration
-- Table: lab_results

CREATE INDEX idx_lab_results_registration ON public.lab_results USING btree (study_registration_id) WHERE (study_registration_id IS NOT NULL);
