-- Policy: Admins can manage suppliers

DROP POLICY IF EXISTS "Admins can manage suppliers" ON public.production_suppliers;
CREATE POLICY "Admins can manage suppliers" ON public.production_suppliers
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
