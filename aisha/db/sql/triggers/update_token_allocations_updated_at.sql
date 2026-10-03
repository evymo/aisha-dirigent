-- Trigger: update_token_allocations_updated_at
-- Table: token_allocations

CREATE TRIGGER update_token_allocations_updated_at
    BEFORE UPDATE ON public.token_allocations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
