-- Policy: Users can view own contributions

CREATE POLICY "Users can view own contributions" ON public.study_contributions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
