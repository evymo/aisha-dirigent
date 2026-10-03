-- Index: idx_member_subscriptions_membership_id
-- Table: member_subscriptions

CREATE INDEX IF NOT EXISTS idx_member_subscriptions_membership_id ON public.member_subscriptions(membership_id);
