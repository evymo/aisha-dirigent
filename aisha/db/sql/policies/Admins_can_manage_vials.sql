-- Policy: Admins can manage vials

DROP POLICY IF EXISTS "Admins can manage vials" ON public.product_vials;
CREATE POLICY "Admins can manage vials" ON public.product_vials
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
