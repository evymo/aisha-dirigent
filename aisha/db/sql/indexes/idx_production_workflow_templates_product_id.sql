-- Index: idx_production_workflow_templates_product_id
-- Table: production_workflow_templates

CREATE INDEX IF NOT EXISTS idx_production_workflow_templates_product_id ON public.production_workflow_templates(product_id);
