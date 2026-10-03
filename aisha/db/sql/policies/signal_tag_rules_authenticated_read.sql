-- Policy: signal_tag_rules_authenticated_read

CREATE POLICY "signal_tag_rules_authenticated_read" ON public.signal_tag_rules
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_active = true));
