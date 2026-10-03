-- Index: idx_partner_stories_user_id
-- Table: partner_stories

CREATE INDEX idx_partner_stories_user_id ON public.partner_stories USING btree (user_id);
