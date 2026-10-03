-- Index: idx_training_datasets_domain_tags
CREATE INDEX IF NOT EXISTS idx_training_datasets_domain_tags ON public.training_datasets
  USING gin(domain_tags);
