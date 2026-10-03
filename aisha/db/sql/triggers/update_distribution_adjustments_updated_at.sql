-- Trigger: update_distribution_adjustments_updated_at
-- Table: distribution_adjustments

CREATE TRIGGER update_distribution_adjustments_updated_at
  BEFORE UPDATE ON public.distribution_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
