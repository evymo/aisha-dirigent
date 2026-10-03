-- Policy: Users can update own contributions

CREATE POLICY "Users can update own contributions" ON public.study_contributions
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((auth.uid() = user_id) AND (status = 'pending'::contribution_status_enum)))
  WITH CHECK ((auth.uid() = user_id));
