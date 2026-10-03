-- Policy: Users can view their own data sharing consents

CREATE POLICY "Users can view their own data sharing consents" ON public.data_sharing_consents
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
