-- Policy: Admins can manage dose units

DROP POLICY IF EXISTS "Admins can manage dose units" ON public.dose_units;
CREATE POLICY "Admins can manage dose units" ON public.dose_units
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
