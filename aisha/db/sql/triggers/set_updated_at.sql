-- Trigger: set_updated_at

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.stripe_disputes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
