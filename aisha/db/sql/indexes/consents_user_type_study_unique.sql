-- Index: consents_user_type_study_unique
-- Table: consents

CREATE UNIQUE INDEX consents_user_type_study_unique ON public.consents USING btree (user_id, consent_type, COALESCE(study_id, '00000000-0000-0000-0000-000000000000'::uuid));
