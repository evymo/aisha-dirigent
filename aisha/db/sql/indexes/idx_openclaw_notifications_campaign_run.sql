-- Index: idx_openclaw_notifications_campaign_run
-- Auto-extracted (back-port reconciliation)

CREATE INDEX IF NOT EXISTS idx_openclaw_notifications_campaign_run ON public.openclaw_notifications USING btree (campaign_run_id) WHERE (campaign_run_id IS NOT NULL);
