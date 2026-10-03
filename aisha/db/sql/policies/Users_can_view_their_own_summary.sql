-- Policy: Users can view their own summary

CREATE POLICY "Users can view their own summary" ON public.alcohol_tracking_summary
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
