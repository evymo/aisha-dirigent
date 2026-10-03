-- Policy: user_engagement_metrics_self_read

CREATE POLICY "user_engagement_metrics_self_read" ON public.user_engagement_metrics
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));
