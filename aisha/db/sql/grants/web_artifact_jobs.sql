-- Grants for web_artifact_jobs table
GRANT SELECT, INSERT, UPDATE ON public.web_artifact_jobs TO authenticated;
GRANT ALL ON public.web_artifact_jobs TO service_role;
