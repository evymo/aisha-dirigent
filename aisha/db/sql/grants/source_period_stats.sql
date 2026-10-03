GRANT SELECT ON public.source_period_stats TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.source_period_stats TO service_role;
