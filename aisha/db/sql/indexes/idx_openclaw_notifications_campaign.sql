-- Index: idx_openclaw_notifications_campaign
-- Auto-extracted (back-port reconciliation)

CREATE INDEX IF NOT EXISTS idx_openclaw_notifications_campaign ON public.openclaw_notifications USING btree (campaign_id) WHERE (campaign_id IS NOT NULL);
