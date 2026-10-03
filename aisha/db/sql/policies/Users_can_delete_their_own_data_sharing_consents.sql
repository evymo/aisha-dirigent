-- Policy: Users can delete their own data sharing consents

CREATE POLICY "Users can delete their own data sharing consents" ON public.data_sharing_consents
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));
