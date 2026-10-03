-- Trigger: update_streak_on_questionnaire
-- Table: questionnaire_responses
-- Purpose: Update streak when user completes questionnaire

CREATE OR REPLACE TRIGGER update_streak_on_questionnaire
  AFTER INSERT ON public.questionnaire_responses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_streak_on_activity();

COMMENT ON TRIGGER update_streak_on_questionnaire ON questionnaire_responses IS 'Update streak when user completes questionnaire';
