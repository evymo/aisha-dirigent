-- Index: idx_training_datasets_org_id
CREATE INDEX IF NOT EXISTS idx_training_datasets_org_id ON public.training_datasets(org_id)
  WHERE org_id IS NOT NULL;
