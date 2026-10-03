-- Policy: Service role full access on bank_transactions

CREATE POLICY "Service role full access on bank_transactions" ON public.bank_transactions
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
