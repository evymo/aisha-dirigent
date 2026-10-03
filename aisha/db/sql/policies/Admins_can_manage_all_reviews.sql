-- Policy: Admins can manage all reviews

DROP POLICY IF EXISTS "Admins can manage all reviews" ON public.partner_appointment_reviews;
CREATE POLICY "Admins can manage all reviews" ON public.partner_appointment_reviews
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
