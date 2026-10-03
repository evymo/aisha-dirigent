-- Index: idx_study_registrations_study_id
-- Table: study_registrations

CREATE INDEX idx_study_registrations_study_id ON public.study_registrations USING btree (study_id);
