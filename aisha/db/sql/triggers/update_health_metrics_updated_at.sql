-- Trigger: update_health_metrics_updated_at
-- Table: health_metrics

CREATE TRIGGER update_health_metrics_updated_at
    BEFORE UPDATE ON public.health_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
