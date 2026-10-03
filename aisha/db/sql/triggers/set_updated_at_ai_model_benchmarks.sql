-- Trigger: set_updated_at_ai_model_benchmarks
-- Table: ai_model_benchmarks

CREATE TRIGGER set_updated_at_ai_model_benchmarks
    BEFORE UPDATE ON public.ai_model_benchmarks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
