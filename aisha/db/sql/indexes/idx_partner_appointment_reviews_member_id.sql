-- Index: idx_partner_appointment_reviews_member_id
-- Table: partner_appointment_reviews

CREATE INDEX IF NOT EXISTS idx_partner_appointment_reviews_member_id ON public.partner_appointment_reviews(member_id);
