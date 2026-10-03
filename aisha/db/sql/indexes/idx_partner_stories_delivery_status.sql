-- Index: idx_partner_stories_delivery_status

CREATE INDEX idx_partner_stories_delivery_status ON public.partner_stories USING btree (delivery_status) WHERE (delivery_status IS NOT NULL);
