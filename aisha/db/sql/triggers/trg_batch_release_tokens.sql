-- Trigger: trg_batch_release_tokens

CREATE TRIGGER trg_batch_release_tokens
  AFTER UPDATE ON public.production_batches
  FOR EACH ROW
  EXECUTE FUNCTION trg_production_batch_release_tokens();
