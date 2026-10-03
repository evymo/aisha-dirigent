-- Policy: Admins can update all lab test orders

DROP POLICY IF EXISTS "Admins can update all lab test orders" ON public.lab_test_orders;
CREATE POLICY "Admins can update all lab test orders" ON public.lab_test_orders
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))))
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));
