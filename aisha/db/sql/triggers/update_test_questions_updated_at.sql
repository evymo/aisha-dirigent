-- Trigger: update_test_questions_updated_at
-- Table: test_questions

CREATE TRIGGER update_test_questions_updated_at
    BEFORE UPDATE ON public.test_questions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
