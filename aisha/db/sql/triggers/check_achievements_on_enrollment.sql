-- Trigger: check_achievements_on_registration
-- Table: study_registrations
-- Purpose: Auto-check achievements when user enrolls in study

CREATE OR REPLACE TRIGGER check_achievements_on_registration
  AFTER INSERT ON public.study_registrations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_check_achievements();

COMMENT ON TRIGGER check_achievements_on_registration ON study_registrations IS 'Auto-check achievements when user enrolls in study';
