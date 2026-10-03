-- Trigger: update_questionnaire_blocks_updated_at
-- Table: questionnaire_blocks

CREATE TRIGGER update_questionnaire_blocks_updated_at
BEFORE UPDATE
ON public.questionnaire_blocks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
