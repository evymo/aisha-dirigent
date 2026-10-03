-- Policy: Users can create own payment sessions

CREATE POLICY "Users can create own payment sessions" ON public.payment_sessions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
