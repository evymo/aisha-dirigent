-- Trigger: update_question_block_types_updated_at
-- Table: question_block_types

CREATE TRIGGER update_question_block_types_updated_at
    BEFORE UPDATE ON public.question_block_types
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
