-- Trigger: set_updated_at_training_datasets
-- Auto-update updated_at on training_datasets table

CREATE TRIGGER set_updated_at_training_datasets
  BEFORE UPDATE ON public.training_datasets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
