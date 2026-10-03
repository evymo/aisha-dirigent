-- Index: idx_consents_user_type
-- Table: consents

CREATE INDEX IF NOT EXISTS idx_consents_user_type
  ON public.consents USING btree (user_id, consent_type);
