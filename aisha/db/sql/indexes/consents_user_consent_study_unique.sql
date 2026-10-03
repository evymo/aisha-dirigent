-- Index: consents_user_consent_study_unique
-- Table: consents

CREATE UNIQUE INDEX IF NOT EXISTS consents_user_consent_study_unique 
  ON public.consents (user_id, consent_type, study_id) 
  WHERE study_id IS NOT NULL;

-- Partial unique index for consents WITHOUT study_id (global consents)
