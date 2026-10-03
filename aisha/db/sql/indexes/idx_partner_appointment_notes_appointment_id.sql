-- Index: idx_partner_appointment_notes_appointment_id
-- Table: partner_appointment_notes

CREATE INDEX IF NOT EXISTS idx_partner_appointment_notes_appointment_id ON public.partner_appointment_notes(appointment_id);
