-- Policy: Admins can manage all appointments

DROP POLICY IF EXISTS "Admins can manage all appointments" ON public.partner_appointments;
CREATE POLICY "Admins can manage all appointments" ON public.partner_appointments
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
