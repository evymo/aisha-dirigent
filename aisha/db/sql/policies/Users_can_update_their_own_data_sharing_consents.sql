-- Policy: Users can update their own data sharing consents

CREATE POLICY "Users can update their own data sharing consents" ON public.data_sharing_consents
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
