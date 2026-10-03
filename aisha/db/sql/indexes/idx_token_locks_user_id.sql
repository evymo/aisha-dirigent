-- Index: idx_token_locks_user_id
-- Table: token_locks

CREATE INDEX IF NOT EXISTS idx_token_locks_user_id ON public.token_locks(user_id);
