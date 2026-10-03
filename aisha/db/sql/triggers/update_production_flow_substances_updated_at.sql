-- Trigger: update_production_flow_substances_updated_at
-- Table: production_flow_substances

CREATE TRIGGER update_production_flow_substances_updated_at
    BEFORE UPDATE ON public.production_flow_substances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
