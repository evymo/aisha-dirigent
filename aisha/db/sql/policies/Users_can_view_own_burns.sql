-- Policy: Users can view own burns

CREATE POLICY "Users can view own burns" ON public.token_burns
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
