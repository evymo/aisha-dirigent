-- Index: idx_member_distribution_plans_protocol_id
-- Table: member_distribution_plans

CREATE INDEX IF NOT EXISTS idx_member_distribution_plans_protocol_id ON public.member_distribution_plans(protocol_id);
