-- Policy: Admins can manage partner reviews

DROP POLICY IF EXISTS "Admins can manage partner reviews" ON public.partner_reviews;
CREATE POLICY "Admins can manage partner reviews" ON public.partner_reviews
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
