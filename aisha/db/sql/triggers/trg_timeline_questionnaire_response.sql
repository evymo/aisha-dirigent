-- Trigger: trg_timeline_questionnaire_response

CREATE TRIGGER trg_timeline_questionnaire_response
  AFTER INSERT ON public.questionnaire_responses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_timeline_questionnaire_response();
