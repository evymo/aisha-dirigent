-- Policy: Anon can read active bindings

CREATE POLICY "Anon can read active bindings" ON public.rule_bindings
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING ((is_active = true));
