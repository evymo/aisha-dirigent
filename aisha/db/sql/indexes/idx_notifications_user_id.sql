-- Index: idx_notifications_user_id
-- Table: notifications

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);
