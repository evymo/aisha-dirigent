-- Trigger: update_study_registrations_updated_at

CREATE TRIGGER update_study_registrations_updated_at
  BEFORE UPDATE ON public.study_registrations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
