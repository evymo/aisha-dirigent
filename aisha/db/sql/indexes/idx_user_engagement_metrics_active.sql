-- Index: idx_user_engagement_metrics_active

CREATE INDEX IF NOT EXISTS idx_user_engagement_metrics_active ON public.user_engagement_metrics USING btree (last_active_at DESC) WHERE (last_active_at IS NOT NULL);
