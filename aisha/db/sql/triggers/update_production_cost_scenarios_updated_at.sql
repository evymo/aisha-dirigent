-- Trigger: update_production_cost_scenarios_updated_at
-- Table: production_cost_scenarios

CREATE TRIGGER update_production_cost_scenarios_updated_at
    BEFORE UPDATE ON public.production_cost_scenarios
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
