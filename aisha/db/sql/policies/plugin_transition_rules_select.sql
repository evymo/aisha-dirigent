-- Policy: plugin_transition_rules_select

CREATE POLICY "plugin_transition_rules_select" ON public.plugin_transition_rules
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
