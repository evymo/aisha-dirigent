-- Index: idx_test_attempts_user_id
-- Table: test_attempts

CREATE INDEX IF NOT EXISTS idx_test_attempts_user_id ON public.test_attempts(user_id);
