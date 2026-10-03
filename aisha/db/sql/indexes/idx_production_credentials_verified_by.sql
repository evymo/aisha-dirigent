-- Index: idx_production_credentials_verified_by
-- Table: production_credentials

CREATE INDEX IF NOT EXISTS idx_production_credentials_verified_by ON public.production_credentials(verified_by);
