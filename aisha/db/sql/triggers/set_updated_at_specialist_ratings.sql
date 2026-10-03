-- Trigger: set_updated_at_specialist_ratings
-- Table: specialist_ratings

CREATE TRIGGER set_updated_at_specialist_ratings
    BEFORE UPDATE ON public.specialist_ratings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

