-- Policy: Anyone can read transition rules

CREATE POLICY "Anyone can read transition rules" ON public.delivery_transition_rules
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
