-- Index: idx_order_approval_rules_created_by
-- Table: order_approval_rules

CREATE INDEX IF NOT EXISTS idx_order_approval_rules_created_by ON public.order_approval_rules(created_by);
