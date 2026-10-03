-- Policy: Users can view own attempts

CREATE POLICY "Users can view own attempts" ON public.test_attempts
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
