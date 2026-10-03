-- Policy: Service role full access on variable_symbol_sequences

CREATE POLICY "Service role full access on variable_symbol_sequences" ON public.variable_symbol_sequences
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
