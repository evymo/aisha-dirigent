-- Index: idx_partner_stories_last_activity
-- Table: partner_stories

CREATE INDEX idx_partner_stories_last_activity ON public.partner_stories USING btree (partner_id, last_activity_at DESC);
