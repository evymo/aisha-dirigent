-- Index: idx_training_examples_source
CREATE INDEX IF NOT EXISTS idx_training_examples_source ON public.training_examples(source_type, source_id)
  WHERE source_id IS NOT NULL;
