-- Policy: Admins can manage vial assignments

DROP POLICY IF EXISTS "Admins can manage vial assignments" ON public.vial_assignments;
CREATE POLICY "Admins can manage vial assignments" ON public.vial_assignments
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
