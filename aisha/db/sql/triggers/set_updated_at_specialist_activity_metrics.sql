-- Trigger: set_updated_at_specialist_activity_metrics
-- Table: specialist_activity_metrics

CREATE TRIGGER set_updated_at_specialist_activity_metrics
    BEFORE UPDATE ON public.specialist_activity_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

