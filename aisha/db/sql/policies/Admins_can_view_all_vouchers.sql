-- Policy: Admins can view all vouchers

DROP POLICY IF EXISTS "Admins can view all vouchers" ON public.product_vouchers;
CREATE POLICY "Admins can view all vouchers" ON public.product_vouchers
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
