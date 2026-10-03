-- Trigger: update_production_cost_lines_updated_at
-- Table: production_cost_lines

CREATE TRIGGER update_production_cost_lines_updated_at
    BEFORE UPDATE ON public.production_cost_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
