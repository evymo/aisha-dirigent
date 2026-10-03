-- Trigger: set_updated_at_workflow_status_transitions
-- Table: workflow_status_transitions

CREATE TRIGGER set_updated_at_workflow_status_transitions
    BEFORE UPDATE ON public.workflow_status_transitions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
