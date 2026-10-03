-- Trigger: update_operational_assessments_updated_at

CREATE TRIGGER update_operational_assessments_updated_at
  BEFORE UPDATE ON public.operational_assessments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
