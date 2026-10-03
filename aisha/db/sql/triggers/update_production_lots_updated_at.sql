-- Trigger: update_production_lots_updated_at
-- Table: production_lots

CREATE TRIGGER update_production_lots_updated_at
    BEFORE UPDATE ON public.production_lots
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
