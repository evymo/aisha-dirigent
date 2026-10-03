-- Index: consents_user_consent_no_study_unique
-- Table: consents

CREATE UNIQUE INDEX IF NOT EXISTS consents_user_consent_no_study_unique 
  ON public.consents (user_id, consent_type) 
  WHERE study_id IS NULL;
