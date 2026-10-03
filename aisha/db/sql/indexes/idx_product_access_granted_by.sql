-- Index: idx_product_access_granted_by
-- Table: product_access

CREATE INDEX IF NOT EXISTS idx_product_access_granted_by ON public.product_access(granted_by);
