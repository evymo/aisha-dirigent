-- Policy: data_sensitivity_registry admin
-- Only admin/staff may add/modify/remove sensitivity classifications. Changing
-- residency policy is a privileged governance action (a wrong downgrade could
-- permit confidential data to a cloud backend), so writes are admin-gated.
DROP POLICY IF EXISTS "data_sensitivity_registry admin" ON public.data_sensitivity_registry;
CREATE POLICY "data_sensitivity_registry admin" ON public.data_sensitivity_registry
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))))
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));
