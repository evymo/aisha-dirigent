-- Policy: sentry_project_issues_read
-- Table: sentry_project_issues

DROP POLICY IF EXISTS sentry_project_issues_read ON public.sentry_project_issues;
CREATE POLICY sentry_project_issues_read ON public.sentry_project_issues
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
