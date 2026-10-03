-- Index: idx_member_subscriptions_user_id
-- Table: member_subscriptions

CREATE INDEX IF NOT EXISTS idx_member_subscriptions_user_id ON public.member_subscriptions(user_id);
