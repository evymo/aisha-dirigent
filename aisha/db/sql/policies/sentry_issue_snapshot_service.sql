-- Policy: sentry_issue_snapshot_service

CREATE POLICY sentry_issue_snapshot_service ON public.sentry_issue_snapshot
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
