-- Index: idx_web_push_subscriptions_user_active
CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_active
  ON public.web_push_subscriptions (user_id, is_active)
  WHERE is_active = true;
