-- Trigger: update_production_workflow_steps_updated_at
-- Table: production_workflow_steps

CREATE TRIGGER update_production_workflow_steps_updated_at
    BEFORE UPDATE ON public.production_workflow_steps
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
