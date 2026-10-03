-- Index: idx_product_access_rules_required_study_id
-- Table: product_access_rules

CREATE INDEX IF NOT EXISTS idx_product_access_rules_required_study_id ON public.product_access_rules(required_study_id);
