-- Index: idx_partner_appointments_member_id
-- Table: partner_appointments

CREATE INDEX idx_partner_appointments_member_id ON public.partner_appointments USING btree (member_id);
