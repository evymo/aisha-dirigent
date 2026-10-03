-- Index: idx_workflow_templates_product_id
-- Table: workflow_templates

CREATE INDEX IF NOT EXISTS idx_workflow_templates_product_id ON public.workflow_templates(product_id);
