-- Index: idx_product_vials_assigned_study_id
-- Table: product_vials

CREATE INDEX IF NOT EXISTS idx_product_vials_assigned_study_id ON public.product_vials(assigned_study_id);
