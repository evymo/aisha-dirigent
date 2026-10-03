-- Trigger: update_distribution_adjustment_updated_at

CREATE TRIGGER update_distribution_adjustment_updated_at
  BEFORE UPDATE ON public.distribution_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION update_distribution_adjustment_timestamp();
