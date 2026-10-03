-- Policy: Admins can manage all availability

DROP POLICY IF EXISTS "Admins can manage all availability" ON public.partner_availability;
CREATE POLICY "Admins can manage all availability" ON public.partner_availability
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
