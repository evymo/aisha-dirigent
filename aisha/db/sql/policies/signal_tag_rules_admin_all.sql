-- Policy: signal_tag_rules_admin_all

DROP POLICY IF EXISTS "signal_tag_rules_admin_all" ON public.signal_tag_rules;
CREATE POLICY "signal_tag_rules_admin_all" ON public.signal_tag_rules
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));
