-- Trigger: set_questionnaire_response_version
-- Table: questionnaire_responses

CREATE TRIGGER set_questionnaire_response_version
BEFORE INSERT
ON public.questionnaire_responses
FOR EACH ROW
EXECUTE FUNCTION set_questionnaire_response_version();
