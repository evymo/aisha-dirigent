-- Policy: Admins can manage product access

DROP POLICY IF EXISTS "Admins can manage product access" ON public.product_access;
CREATE POLICY "Admins can manage product access" ON public.product_access
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
