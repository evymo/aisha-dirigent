-- Index: idx_partner_appointments_partner_id
-- Table: partner_appointments

CREATE INDEX idx_partner_appointments_partner_id ON public.partner_appointments USING btree (partner_id);
