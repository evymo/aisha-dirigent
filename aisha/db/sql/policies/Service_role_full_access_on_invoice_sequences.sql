-- Policy: Service role full access on invoice_sequences

CREATE POLICY "Service role full access on invoice_sequences" ON public.invoice_sequences
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
