-- Trigger: trg_auto_create_story_on_registration

CREATE TRIGGER trg_auto_create_story_on_registration
  AFTER UPDATE ON public.study_registrations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_create_story_on_registration();
