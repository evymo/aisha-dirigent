-- Policy: Users can insert their own health metrics

CREATE POLICY "Users can insert their own health metrics" ON public.health_metrics
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
