-- Policy: Users can view own allocations

CREATE POLICY "Users can view own allocations" ON public.token_allocations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
