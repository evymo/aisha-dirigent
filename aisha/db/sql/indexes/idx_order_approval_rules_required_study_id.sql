-- Index: idx_order_approval_rules_required_study_id
-- Table: order_approval_rules

CREATE INDEX IF NOT EXISTS idx_order_approval_rules_required_study_id ON public.order_approval_rules(required_study_id);
