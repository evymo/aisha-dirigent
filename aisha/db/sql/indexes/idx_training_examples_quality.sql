-- Index: idx_training_examples_quality
CREATE INDEX IF NOT EXISTS idx_training_examples_quality ON public.training_examples(quality_score DESC NULLS LAST)
  WHERE is_validated = true;
