-- Trigger: update_distribution_forecasts_updated_at
-- Table: distribution_forecasts

CREATE TRIGGER update_distribution_forecasts_updated_at
    BEFORE UPDATE ON public.distribution_forecasts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
