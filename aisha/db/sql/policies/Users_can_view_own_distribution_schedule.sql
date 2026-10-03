-- Policy: Users can view own distribution schedule

CREATE POLICY "Users can view own distribution schedule" ON public.user_distribution_schedule
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
