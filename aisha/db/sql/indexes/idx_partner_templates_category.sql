-- Index: idx_partner_templates_category
-- Table: partner_templates

CREATE INDEX idx_partner_templates_category ON public.partner_templates USING btree (category);
