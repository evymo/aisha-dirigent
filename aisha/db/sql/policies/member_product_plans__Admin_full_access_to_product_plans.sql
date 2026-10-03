-- Policy: Admin full access to product plans

DROP POLICY IF EXISTS "Admin full access to product plans" ON public.member_product_plans;
CREATE POLICY "Admin full access to product plans" ON public.member_product_plans
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))))
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));
