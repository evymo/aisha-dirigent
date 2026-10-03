-- Policy: Users can view own wallet

CREATE POLICY "Users can view own wallet" ON public.user_wallets
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
