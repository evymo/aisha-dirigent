-- Trigger: update_distribution_forecast_items_updated_at
-- Table: distribution_forecast_items

CREATE TRIGGER update_distribution_forecast_items_updated_at
BEFORE UPDATE
ON public.distribution_forecast_items
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
