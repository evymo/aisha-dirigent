-- Policy: Admins can manage coefficients

DROP POLICY IF EXISTS "Admins can manage coefficients" ON public.production_coefficients;
CREATE POLICY "Admins can manage coefficients" ON public.production_coefficients
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
