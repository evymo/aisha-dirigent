-- Index: idx_user_engagement_metrics_audience

CREATE INDEX IF NOT EXISTS idx_user_engagement_metrics_audience ON public.user_engagement_metrics USING btree (audience_size DESC) WHERE (audience_size > 0);
