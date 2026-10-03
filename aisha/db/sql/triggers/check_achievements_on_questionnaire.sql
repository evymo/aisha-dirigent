-- Trigger: check_achievements_on_questionnaire
-- Table: questionnaire_responses
-- Purpose: Auto-check achievements when user completes questionnaire

CREATE OR REPLACE TRIGGER check_achievements_on_questionnaire
  AFTER INSERT ON public.questionnaire_responses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_check_achievements();

COMMENT ON TRIGGER check_achievements_on_questionnaire ON questionnaire_responses IS 'Auto-check achievements when user completes questionnaire';
