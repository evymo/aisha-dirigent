-- Index: idx_partner_appointment_notes_author_id
-- Table: partner_appointment_notes

CREATE INDEX IF NOT EXISTS idx_partner_appointment_notes_author_id ON public.partner_appointment_notes(author_id);
