-- Trigger: update_production_cost_rates_updated_at
-- Table: production_cost_rates

CREATE TRIGGER update_production_cost_rates_updated_at
    BEFORE UPDATE ON public.production_cost_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
