-- Policy: Users can update their own consents

CREATE POLICY "Users can update their own consents" ON public.consents
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
