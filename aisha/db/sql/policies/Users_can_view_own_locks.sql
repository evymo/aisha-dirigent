-- Policy: Users can view own locks

CREATE POLICY "Users can view own locks" ON public.token_locks
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
