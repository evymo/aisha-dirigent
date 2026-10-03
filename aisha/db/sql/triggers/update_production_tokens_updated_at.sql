-- Trigger: update_production_tokens_updated_at
-- Table: production_tokens

CREATE TRIGGER update_production_tokens_updated_at
    BEFORE UPDATE ON public.production_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
