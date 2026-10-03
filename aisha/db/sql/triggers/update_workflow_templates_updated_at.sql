-- Trigger: update_workflow_templates_updated_at
-- Table: workflow_templates

CREATE TRIGGER update_workflow_templates_updated_at
    BEFORE UPDATE ON public.workflow_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
