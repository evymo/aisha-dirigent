-- Trigger: update_production_workflow_templates_updated_at
-- Table: production_workflow_templates

CREATE TRIGGER update_production_workflow_templates_updated_at
    BEFORE UPDATE ON public.production_workflow_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
