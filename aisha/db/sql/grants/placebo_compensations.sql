-- Grants: placebo_compensations

GRANT SELECT ON public.placebo_compensations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.placebo_compensations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.placebo_compensations TO service_role;
