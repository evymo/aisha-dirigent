-- Index: idx_partner_stories_status
-- Table: partner_stories

CREATE INDEX idx_partner_stories_status ON public.partner_stories USING btree (partner_id, status);
