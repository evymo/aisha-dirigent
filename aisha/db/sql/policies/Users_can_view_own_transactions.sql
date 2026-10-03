-- Policy: Users can view own transactions

CREATE POLICY "Users can view own transactions" ON public.token_transactions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
