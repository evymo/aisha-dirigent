-- Policy: Admins can manage product dose units

DROP POLICY IF EXISTS "Admins can manage product dose units" ON public.product_dose_units;
CREATE POLICY "Admins can manage product dose units" ON public.product_dose_units
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
