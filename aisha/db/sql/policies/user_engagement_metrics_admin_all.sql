-- Policy: user_engagement_metrics_admin_all

DROP POLICY IF EXISTS "user_engagement_metrics_admin_all" ON public.user_engagement_metrics;
CREATE POLICY "user_engagement_metrics_admin_all" ON public.user_engagement_metrics
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));
