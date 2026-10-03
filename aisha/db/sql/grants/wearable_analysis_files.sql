-- Grants: wearable_analysis_files

GRANT SELECT ON public.wearable_analysis_files TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wearable_analysis_files TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wearable_analysis_files TO service_role;
