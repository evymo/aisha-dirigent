-- Trigger: update_alcohol_tracking_summary_updated_at
-- Table: alcohol_tracking_summary

CREATE TRIGGER update_alcohol_tracking_summary_updated_at
    BEFORE UPDATE ON public.alcohol_tracking_summary
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
