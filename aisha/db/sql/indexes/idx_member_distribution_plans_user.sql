-- Index: idx_member_distribution_plans_user
-- Table: member_distribution_plans

CREATE INDEX idx_member_distribution_plans_user ON public.member_distribution_plans USING btree (user_id);
