-- Grants: v_health_weekly_summary

GRANT SELECT ON public.v_health_weekly_summary TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.v_health_weekly_summary TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.v_health_weekly_summary TO service_role;
