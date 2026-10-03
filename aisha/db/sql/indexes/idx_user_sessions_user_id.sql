-- Index: idx_user_sessions_user_id
-- Table: user_sessions

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
