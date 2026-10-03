-- Grants: plugin_schedules

GRANT SELECT ON public.plugin_schedules TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.plugin_schedules TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.plugin_schedules TO service_role;
