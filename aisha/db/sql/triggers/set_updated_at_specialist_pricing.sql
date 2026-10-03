-- Trigger: set_updated_at_specialist_pricing
-- Table: specialist_pricing

CREATE TRIGGER set_updated_at_specialist_pricing
    BEFORE UPDATE ON public.specialist_pricing
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

