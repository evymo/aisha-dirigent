-- Trigger: update_study_distribution_protocols_updated_at

CREATE TRIGGER update_study_distribution_protocols_updated_at
  BEFORE UPDATE ON public.study_distribution_protocols
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
