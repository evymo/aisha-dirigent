-- Policy: Authenticated can read active bindings

CREATE POLICY "Authenticated can read active bindings" ON public.rule_bindings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_active = true));
