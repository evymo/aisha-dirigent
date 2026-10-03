-- Trigger: update_questionnaires_updated_at
-- Table: questionnaires

CREATE TRIGGER update_questionnaires_updated_at
BEFORE UPDATE
ON public.questionnaires
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
