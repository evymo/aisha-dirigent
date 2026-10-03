-- Policy: Admins can manage all certifications

DROP POLICY IF EXISTS "Admins can manage all certifications" ON public.partner_certifications;
CREATE POLICY "Admins can manage all certifications" ON public.partner_certifications
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
