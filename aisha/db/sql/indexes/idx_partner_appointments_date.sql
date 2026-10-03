-- Index: idx_partner_appointments_date
-- Table: partner_appointments

CREATE INDEX IF NOT EXISTS idx_partner_appointments_date
  ON public.partner_appointments USING btree (appointment_date);
