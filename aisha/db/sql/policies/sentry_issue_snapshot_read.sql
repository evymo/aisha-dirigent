-- Policy: sentry_issue_snapshot_read

DROP POLICY IF EXISTS sentry_issue_snapshot_read ON public.sentry_issue_snapshot;
CREATE POLICY sentry_issue_snapshot_read ON public.sentry_issue_snapshot
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
