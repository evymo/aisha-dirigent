-- Policy: Users can view own payment sessions

CREATE POLICY "Users can view own payment sessions" ON public.payment_sessions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
