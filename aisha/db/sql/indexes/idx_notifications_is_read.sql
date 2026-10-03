-- Index: idx_notifications_is_read
-- Table: notifications

CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (is_read);
