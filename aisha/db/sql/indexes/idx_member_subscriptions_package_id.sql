-- Index: idx_member_subscriptions_package_id
-- Table: member_subscriptions

CREATE INDEX IF NOT EXISTS idx_member_subscriptions_package_id ON public.member_subscriptions(package_id);
