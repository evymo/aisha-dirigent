-- Trigger: set_updated_at_project_revenue
-- Table: project_revenue

CREATE TRIGGER set_updated_at_project_revenue
    BEFORE UPDATE ON public.project_revenue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

