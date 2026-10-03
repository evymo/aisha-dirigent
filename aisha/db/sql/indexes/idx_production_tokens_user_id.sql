-- Index: idx_production_tokens_user_id
-- Table: production_tokens

CREATE INDEX IF NOT EXISTS idx_production_tokens_user_id ON public.production_tokens(user_id);
