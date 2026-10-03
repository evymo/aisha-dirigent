-- Index: idx_app_secrets_updated_at
-- Table: app_secrets

CREATE INDEX idx_app_secrets_updated_at ON public.app_secrets USING btree (updated_at);
