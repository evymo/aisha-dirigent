-- Policy: Users can update their own health metrics

CREATE POLICY "Users can update their own health metrics" ON public.health_metrics
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
