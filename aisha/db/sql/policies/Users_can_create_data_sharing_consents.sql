-- Policy: Users can create data sharing consents

CREATE POLICY "Users can create data sharing consents" ON public.data_sharing_consents
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
