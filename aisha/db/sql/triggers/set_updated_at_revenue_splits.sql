-- Trigger: set_updated_at_revenue_splits
-- Table: revenue_splits

CREATE TRIGGER set_updated_at_revenue_splits
    BEFORE UPDATE ON public.revenue_splits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

