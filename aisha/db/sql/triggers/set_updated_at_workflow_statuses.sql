-- Trigger: set_updated_at_workflow_statuses
-- Table: workflow_statuses
-- Mirrors the convention used by delivery_transition_rules — every table
-- with an updated_at column gets a BEFORE UPDATE trigger that bumps the
-- timestamp via the shared update_updated_at_column() function.

CREATE TRIGGER set_updated_at_workflow_statuses
    BEFORE UPDATE ON public.workflow_statuses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
