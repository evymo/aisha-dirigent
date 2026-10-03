-- Policy: Users can view their own consents

CREATE POLICY "Users can view their own consents" ON public.consents
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = user_id));
