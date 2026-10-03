-- Trigger: update_production_metrics_updated_at
-- Table: production_metrics

CREATE TRIGGER update_production_metrics_updated_at
    BEFORE UPDATE ON public.production_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
