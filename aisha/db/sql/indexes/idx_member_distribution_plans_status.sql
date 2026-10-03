-- Index: idx_member_distribution_plans_status
-- Table: member_distribution_plans

CREATE INDEX idx_member_distribution_plans_status ON public.member_distribution_plans USING btree (status);
