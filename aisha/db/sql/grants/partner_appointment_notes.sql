-- Grants: partner_appointment_notes

GRANT SELECT ON public.partner_appointment_notes TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.partner_appointment_notes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.partner_appointment_notes TO service_role;
