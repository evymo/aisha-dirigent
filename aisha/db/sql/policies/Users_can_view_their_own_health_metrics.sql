-- Policy: Users can view their own health metrics

CREATE POLICY "Users can view their own health metrics" ON public.health_metrics
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
