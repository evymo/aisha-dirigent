-- Grants: dirigent_nudges
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql

GRANT SELECT ON public.dirigent_nudges TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.dirigent_nudges TO service_role;
