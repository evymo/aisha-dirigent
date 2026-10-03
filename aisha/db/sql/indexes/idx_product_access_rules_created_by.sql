-- Index: idx_product_access_rules_created_by
-- Table: product_access_rules

CREATE INDEX IF NOT EXISTS idx_product_access_rules_created_by ON public.product_access_rules(created_by);
