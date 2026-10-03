-- Policy: Users can delete their own consents

CREATE POLICY "Users can delete their own consents" ON public.consents
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((auth.uid() = user_id));
