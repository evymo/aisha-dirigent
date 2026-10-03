-- Trigger: update_token_locks_updated_at
-- Table: token_locks

CREATE TRIGGER update_token_locks_updated_at
    BEFORE UPDATE ON public.token_locks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
