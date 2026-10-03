-- Policy: Admins can view all lab test orders

DROP POLICY IF EXISTS "Admins can view all lab test orders" ON public.lab_test_orders;
CREATE POLICY "Admins can view all lab test orders" ON public.lab_test_orders
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
