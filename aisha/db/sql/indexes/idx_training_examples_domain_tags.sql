-- Index: idx_training_examples_domain_tags
CREATE INDEX IF NOT EXISTS idx_training_examples_domain_tags ON public.training_examples
  USING gin(domain_tags);
