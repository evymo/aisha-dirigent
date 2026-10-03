-- Index: idx_product_access_rules_product
-- Table: product_access_rules

CREATE INDEX idx_product_access_rules_product ON public.product_access_rules USING btree (product_id) WHERE (is_active = true);
