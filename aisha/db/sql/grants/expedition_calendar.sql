-- Grants: expedition_calendar

GRANT SELECT ON public.expedition_calendar TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.expedition_calendar TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expedition_calendar TO service_role;
