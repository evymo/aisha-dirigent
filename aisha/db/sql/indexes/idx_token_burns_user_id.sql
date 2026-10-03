-- Index: idx_token_burns_user_id
-- Table: token_burns

CREATE INDEX IF NOT EXISTS idx_token_burns_user_id ON public.token_burns(user_id);
