-- Policy: Users can create own contributions

CREATE POLICY "Users can create own contributions" ON public.study_contributions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
