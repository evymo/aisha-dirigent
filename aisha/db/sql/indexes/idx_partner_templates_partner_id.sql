-- Index: idx_partner_templates_partner_id
-- Table: partner_templates

CREATE INDEX idx_partner_templates_partner_id ON public.partner_templates USING btree (partner_id);
