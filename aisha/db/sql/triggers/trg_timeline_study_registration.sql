-- Trigger: trg_timeline_study_registration

CREATE TRIGGER trg_timeline_study_registration
  AFTER INSERT ON public.study_registrations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_timeline_study_registration();
