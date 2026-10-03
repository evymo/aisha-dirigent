-- Trigger: update_question_blocks_updated_at
-- Table: question_blocks

CREATE TRIGGER update_question_blocks_updated_at
    BEFORE UPDATE ON public.question_blocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
