-- Index: idx_user_engagement_metrics_computed

CREATE INDEX IF NOT EXISTS idx_user_engagement_metrics_computed ON public.user_engagement_metrics USING btree (computed_at DESC);
