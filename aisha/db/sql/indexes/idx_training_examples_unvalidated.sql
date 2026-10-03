-- Index: idx_training_examples_unvalidated
CREATE INDEX IF NOT EXISTS idx_training_examples_unvalidated ON public.training_examples(created_at)
  WHERE is_validated = false;
