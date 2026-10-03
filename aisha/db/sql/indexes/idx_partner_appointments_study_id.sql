-- Index: idx_partner_appointments_study_id
-- Table: partner_appointments

CREATE INDEX IF NOT EXISTS idx_partner_appointments_study_id ON public.partner_appointments(study_id);
