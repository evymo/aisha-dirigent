-- Index: idx_web_push_subscriptions_user_id
-- Table: web_push_subscriptions
-- Purpose: FK index on user_id for JOIN/CASCADE performance

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_id
  ON public.web_push_subscriptions (user_id);
