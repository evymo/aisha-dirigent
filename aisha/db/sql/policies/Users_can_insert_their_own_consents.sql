-- Policy: Users can insert their own consents

CREATE POLICY "Users can insert their own consents" ON public.consents
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = user_id));
