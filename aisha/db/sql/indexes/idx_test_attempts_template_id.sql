-- Index: idx_test_attempts_template_id
-- Table: test_attempts

CREATE INDEX IF NOT EXISTS idx_test_attempts_template_id ON public.test_attempts(template_id);
