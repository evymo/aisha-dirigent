-- Trigger: update_growth_policy_parameters_updated_at
-- Table: growth_policy_parameters

CREATE TRIGGER update_growth_policy_parameters_updated_at
    BEFORE UPDATE ON public.growth_policy_parameters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
