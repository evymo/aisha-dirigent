-- Index: idx_member_product_plans_protocol_id
-- Table: member_product_plans

CREATE INDEX IF NOT EXISTS idx_member_product_plans_protocol_id ON public.member_product_plans(protocol_id);
