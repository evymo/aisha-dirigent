-- Index: idx_openclaw_notifications_user
-- Auto-extracted (back-port reconciliation)

CREATE INDEX IF NOT EXISTS idx_openclaw_notifications_user ON public.openclaw_notifications USING btree (user_id) WHERE (user_id IS NOT NULL);
